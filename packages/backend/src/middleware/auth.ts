import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  user?: { id: string; username: string; email: string };
}

export function authenticate(req: AuthRequest, res: Response, next: NextFunction): void {
  const token = req.headers.authorization?.replace('Bearer ', '').trim();

  if (!token) {
    res.status(401).json({ error: 'No token provided', code: 'NO_TOKEN' });
    return;
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
      id: string; username: string; email: string;
    };
    req.user = decoded;
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    } else {
      res.status(401).json({ error: 'Invalid token', code: 'INVALID_TOKEN' });
    }
  }
}

export function optionalAuth(req: AuthRequest, _res: Response, next: NextFunction): void {
  const token = req.headers.authorization?.replace('Bearer ', '').trim();
  if (token) {
    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET!) as {
        id: string; username: string; email: string;
      };
    } catch {
      // Ignore — optional auth doesn't fail on bad/expired tokens
    }
  }
  next();
}
