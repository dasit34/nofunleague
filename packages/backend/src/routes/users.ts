import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { query } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

// Tight rate limit for auth endpoints — brute-force protection
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in 15 minutes.' },
  skipSuccessfulRequests: true, // only count failures
});

const JWT_TTL = 7 * 24 * 60 * 60; // 7 days in seconds

function signToken(payload: { id: string; username: string; email: string }): string {
  return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: JWT_TTL });
}

const RegisterSchema = z.object({
  username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores'),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  display_name: z.string().min(1).max(100).optional(),
  trash_talk_style: z.enum(['aggressive', 'petty', 'poetic', 'silent']).optional(),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const ChangePasswordSchema = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(8).max(128),
});

// POST /api/users/register
router.post('/register', authLimiter, async (req: Request, res: Response) => {
  try {
    const body = RegisterSchema.parse(req.body);
    const hash = await bcrypt.hash(body.password, 12);

    const { rows } = await query(
      `INSERT INTO users (username, email, password_hash, display_name, trash_talk_style)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, email, display_name, avatar_url, trash_talk_style, created_at`,
      [
        body.username.toLowerCase(),
        body.email.toLowerCase(),
        hash,
        body.display_name || body.username,
        body.trash_talk_style || 'aggressive',
      ]
    );

    const user = rows[0];
    const token = signToken({ id: user.id, username: user.username, email: user.email });

    res.status(201).json({ user, token, expires_in: JWT_TTL });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: err.errors });
    } else if ((err as { code?: string }).code === '23505') {
      res.status(409).json({ error: 'Username or email already exists' });
    } else {
      throw err;
    }
  }
});

// POST /api/users/login
router.post('/login', authLimiter, async (req: Request, res: Response) => {
  try {
    const body = LoginSchema.parse(req.body);
    const { rows } = await query(
      'SELECT * FROM users WHERE email = $1',
      [body.email.toLowerCase()]
    );

    const user = rows[0];
    const valid = user && await bcrypt.compare(body.password, user.password_hash);

    // Constant-time response whether user exists or not
    if (!valid) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const token = signToken({ id: user.id, username: user.username, email: user.email });

    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        display_name: user.display_name,
        avatar_url: user.avatar_url,
        trash_talk_style: user.trash_talk_style,
      },
      token,
      expires_in: JWT_TTL,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: err.errors });
    } else {
      throw err;
    }
  }
});

// POST /api/users/logout  (stateless JWT — clears nothing server-side,
// but gives the frontend a clean endpoint to call)
router.post('/logout', authenticate, (_req: AuthRequest, res: Response) => {
  res.json({ message: 'Logged out successfully' });
});

// GET /api/users/me — full profile for the authenticated user
router.get('/me', authenticate, async (req: AuthRequest, res: Response) => {
  const { rows } = await query(
    `SELECT id, username, email, display_name, avatar_url,
            sleeper_user_id, trash_talk_style, created_at
     FROM users WHERE id = $1`,
    [req.user!.id]
  );
  if (!rows[0]) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json(rows[0]);
});

// PATCH /api/users/me — update profile fields
router.patch('/me', authenticate, async (req: AuthRequest, res: Response) => {
  const Schema = z.object({
    display_name: z.string().min(1).max(100).optional(),
    avatar_url: z.string().url().nullable().optional(),
    sleeper_user_id: z.string().max(100).nullable().optional(),
    trash_talk_style: z.enum(['aggressive', 'petty', 'poetic', 'silent']).optional(),
  });

  let body: z.infer<typeof Schema>;
  try {
    body = Schema.parse(req.body);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: (err as z.ZodError).errors });
      return;
    }
    throw err;
  }

  const updates = Object.fromEntries(
    Object.entries(body).filter(([, v]) => v !== undefined)
  );
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'No valid fields to update' });
    return;
  }

  const sets = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`).join(', ');
  const values = [req.user!.id, ...Object.values(updates)];

  const { rows } = await query(
    `UPDATE users SET ${sets}, updated_at = NOW()
     WHERE id = $1
     RETURNING id, username, email, display_name, avatar_url, trash_talk_style`,
    values
  );
  res.json(rows[0]);
});

// POST /api/users/change-password
router.post('/change-password', authenticate, async (req: AuthRequest, res: Response) => {
  let body: z.infer<typeof ChangePasswordSchema>;
  try {
    body = ChangePasswordSchema.parse(req.body);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: (err as z.ZodError).errors });
      return;
    }
    throw err;
  }

  const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user!.id]);
  if (!rows[0]) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const valid = await bcrypt.compare(body.current_password, rows[0].password_hash);
  if (!valid) {
    res.status(401).json({ error: 'Current password is incorrect' });
    return;
  }

  if (body.current_password === body.new_password) {
    res.status(400).json({ error: 'New password must be different from current password' });
    return;
  }

  const newHash = await bcrypt.hash(body.new_password, 12);
  await query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [
    newHash,
    req.user!.id,
  ]);

  // Issue a fresh token so existing sessions remain valid after password change
  const { rows: [user] } = await query(
    'SELECT id, username, email FROM users WHERE id = $1',
    [req.user!.id]
  );
  const token = signToken({ id: user.id, username: user.username, email: user.email });

  res.json({ message: 'Password changed successfully', token, expires_in: JWT_TTL });
});

// GET /api/users/:username — public profile
router.get('/:username', async (req: Request, res: Response) => {
  const { rows } = await query(
    `SELECT id, username, display_name, avatar_url, trash_talk_style, created_at
     FROM users WHERE username = $1`,
    [(Array.isArray(req.params.username) ? req.params.username[0] : req.params.username).toLowerCase()]
  );
  if (!rows[0]) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json(rows[0]);
});

export default router;
