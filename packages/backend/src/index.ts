import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

import usersRouter from './routes/users';
import leaguesRouter from './routes/leagues';
import teamsRouter from './routes/teams';
import playersRouter from './routes/players';
import chatRouter from './routes/chat';
import aiRouter from './routes/ai';
import { errorHandler, notFound } from './middleware/errorHandler';
import { validateEnv } from './config/startup';

dotenv.config();
validateEnv();

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

// =============================================
// Health check — before all middleware so
// Railway's healthcheck is never rate-limited
// or blocked by CORS / helmet
// =============================================
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', app: 'The No Fun League API', timestamp: new Date().toISOString() });
});

// =============================================
// Security & Middleware
// =============================================
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// AI routes get tighter limits (Anthropic API costs $$$)
const aiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 10,
  message: { error: 'Too many AI requests. Slow your roll.' },
});

// Auth endpoints: max 10 failed attempts per 15 min (brute-force protection)
// Note: per-route authLimiter also applied directly in users.ts
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts. Try again later.' },
});

// =============================================
// Routes
// =============================================
app.use('/api/users', authLimiter, usersRouter);
app.use('/api/leagues', leaguesRouter);
app.use('/api/teams', teamsRouter);
app.use('/api/players', playersRouter);
app.use('/api/chat', chatRouter);
app.use('/api/ai', aiLimiter, aiRouter);

// =============================================
// Error Handling
// =============================================
app.use(notFound);
app.use(errorHandler);

// =============================================
// Start
// =============================================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[NFL] Server listening on 0.0.0.0:${PORT} (${process.env.NODE_ENV || 'development'})`);
});

export default app;
