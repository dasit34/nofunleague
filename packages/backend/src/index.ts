import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

// Load env vars FIRST
dotenv.config();

const IS_PROD = process.env.NODE_ENV === 'production';

// In production, PORT must come from Railway — no fallback.
// In dev, default to 3001.
const PORT = process.env.PORT
  ? parseInt(process.env.PORT, 10)
  : IS_PROD ? (() => { console.error('[NFL] FATAL: PORT env var is required in production'); process.exit(1); return 0; })()
  : 3001;

console.log('[NFL] Starting server...');
console.log('[NFL] ENV:', process.env.NODE_ENV || 'development');
console.log('[NFL] PORT:', PORT);

const app = express();

// =============================================
// Health checks — BEFORE all middleware so Railway's
// healthcheck is never blocked by CORS / helmet / rate-limit.
// These must respond even if DB is down.
// =============================================
app.get('/', (_req, res) => {
  res.send('No Fun League API is running');
});

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', app: 'The No Fun League API', timestamp: new Date().toISOString() });
});

app.get('/api/health', (_req, res) => {
  res.status(200).json({ status: 'ok', app: 'The No Fun League API', timestamp: new Date().toISOString() });
});

// =============================================
// Validate env — warn, never throw
// =============================================
const requiredEnvVars = ['DATABASE_URL', 'JWT_SECRET'];
const missingVars = requiredEnvVars.filter((k) => !process.env[k]);
if (missingVars.length > 0) {
  console.warn(`[NFL] WARNING: Missing env vars: ${missingVars.join(', ')}`);
  console.warn('[NFL] API routes will fail but healthcheck will still respond.');
}

// =============================================
// Security & Middleware
// =============================================
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  process.env.FRONTEND_URL,
].filter(Boolean) as string[];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (server-to-server, curl, mobile)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`[NFL] CORS blocked origin: ${origin}`);
      callback(null, false);
    }
  },
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many AI requests. Slow your roll.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts. Try again later.' },
});

// =============================================
// Routes — wrapped so failures don't block listen
// =============================================
try {
  const usersRouter = require('./routes/users').default;
  const leaguesRouter = require('./routes/leagues').default;
  const teamsRouter = require('./routes/teams').default;
  const playersRouter = require('./routes/players').default;
  const chatRouter = require('./routes/chat').default;
  const aiRouter = require('./routes/ai').default;
  const tradesRouter = require('./routes/trades').default;
  const draftRouter = require('./routes/draft').default;
  const invitesRouter = require('./routes/invites').default;
  const adminRouter = require('./routes/admin').default;
  const waiversRouter = require('./routes/waivers').default;
  const commissionerRouter = require('./routes/commissioner').default;
  const { errorHandler, notFound } = require('./middleware/errorHandler');

  app.use('/api/users', authLimiter, usersRouter);
  app.use('/api/leagues', leaguesRouter);
  app.use('/api/teams', teamsRouter);
  app.use('/api/players', playersRouter);
  app.use('/api/chat', chatRouter);
  app.use('/api/ai', aiLimiter, aiRouter);
  app.use('/api/trades', tradesRouter);
  app.use('/api/draft', draftRouter);
  app.use('/api', invitesRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/leagues', waiversRouter);
  app.use('/api/leagues/:id/commissioner', commissionerRouter);

  app.use(notFound);
  app.use(errorHandler);

  console.log('[NFL] All routes loaded');
} catch (err) {
  console.error('[NFL] ROUTE LOAD FAILURE:', (err as Error).message);
}

// =============================================
// Start server
// =============================================
console.log(`[NFL] About to listen on port ${PORT}...`);

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[NFL] Server listening on 0.0.0.0:${PORT}`);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  console.error(`[NFL] FATAL: ${err.code === 'EADDRINUSE' ? `Port ${PORT} in use` : err.message}`);
  process.exit(1);
});

server.on('listening', () => {
  try {
    const { startScheduler } = require('./services/scheduler');
    startScheduler();
  } catch (err) {
    console.warn('[NFL] Scheduler failed:', (err as Error).message);
  }
});

export default app;
