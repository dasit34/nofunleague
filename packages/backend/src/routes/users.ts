import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { query } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

const RegisterSchema = z.object({
  username: z.string().min(3).max(50),
  email: z.string().email(),
  password: z.string().min(8),
  display_name: z.string().optional(),
  trash_talk_style: z.enum(['aggressive', 'petty', 'poetic', 'silent']).optional(),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

// POST /api/users/register
router.post('/register', async (req: Request, res: Response) => {
  try {
    const body = RegisterSchema.parse(req.body);
    const hash = await bcrypt.hash(body.password, 12);

    const { rows } = await query(
      `INSERT INTO users (username, email, password_hash, display_name, trash_talk_style)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, email, display_name, trash_talk_style, created_at`,
      [body.username, body.email, hash, body.display_name || body.username, body.trash_talk_style || 'aggressive']
    );

    const user = rows[0];
    const token = jwt.sign(
      { id: user.id, username: user.username, email: user.email },
      process.env.JWT_SECRET!,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.status(201).json({ user, token });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors });
    } else if ((err as { code?: string }).code === '23505') {
      res.status(409).json({ error: 'Username or email already exists' });
    } else {
      throw err;
    }
  }
});

// POST /api/users/login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const body = LoginSchema.parse(req.body);
    const { rows } = await query('SELECT * FROM users WHERE email = $1', [body.email]);

    if (!rows[0]) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const valid = await bcrypt.compare(body.password, rows[0].password_hash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const user = rows[0];
    const token = jwt.sign(
      { id: user.id, username: user.username, email: user.email },
      process.env.JWT_SECRET!,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.json({ user: { id: user.id, username: user.username, email: user.email, display_name: user.display_name, trash_talk_style: user.trash_talk_style }, token });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors });
    } else {
      throw err;
    }
  }
});

// GET /api/users/me
router.get('/me', authenticate, async (req: AuthRequest, res: Response) => {
  const { rows } = await query(
    'SELECT id, username, email, display_name, avatar_url, sleeper_user_id, trash_talk_style, created_at FROM users WHERE id = $1',
    [req.user!.id]
  );
  res.json(rows[0]);
});

// PATCH /api/users/me
router.patch('/me', authenticate, async (req: AuthRequest, res: Response) => {
  const allowed = ['display_name', 'avatar_url', 'sleeper_user_id', 'trash_talk_style'];
  const updates = Object.fromEntries(
    Object.entries(req.body).filter(([k]) => allowed.includes(k))
  );

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'No valid fields to update' });
    return;
  }

  const sets = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`).join(', ');
  const values = [req.user!.id, ...Object.values(updates)];

  const { rows } = await query(
    `UPDATE users SET ${sets}, updated_at = NOW() WHERE id = $1 RETURNING id, username, email, display_name, trash_talk_style`,
    values
  );
  res.json(rows[0]);
});

export default router;
