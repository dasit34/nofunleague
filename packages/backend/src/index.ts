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

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

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

// =============================================
// Routes
// =============================================
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', app: 'The No Fun League API', timestamp: new Date().toISOString() });
});

app.use('/api/users', usersRouter);
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
app.listen(PORT, () => {
  console.log(`
 ███╗   ██╗ ██████╗     ███████╗██╗   ██╗███╗   ██╗
 ████╗  ██║██╔═══██╗    ██╔════╝██║   ██║████╗  ██║
 ██╔██╗ ██║██║   ██║    █████╗  ██║   ██║██╔██╗ ██║
 ██║╚██╗██║██║   ██║    ██╔══╝  ██║   ██║██║╚██╗██║
 ██║ ╚████║╚██████╔╝    ██║     ╚██████╔╝██║ ╚████║
 ╚═╝  ╚═══╝ ╚═════╝     ╚═╝      ╚═════╝ ╚═╝  ╚═══╝
 ██╗     ███████╗ █████╗  ██████╗ ██╗   ██╗███████╗
 ██║     ██╔════╝██╔══██╗██╔════╝ ██║   ██║██╔════╝
 ██║     █████╗  ███████║██║  ███╗██║   ██║█████╗
 ██║     ██╔══╝  ██╔══██║██║   ██║██║   ██║██╔══╝
 ███████╗███████╗██║  ██║╚██████╔╝╚██████╔╝███████╗
 ╚══════╝╚══════╝╚═╝  ╚═╝ ╚═════╝  ╚═════╝╚══════╝

 API running on port ${PORT}
 Environment: ${process.env.NODE_ENV || 'development'}
  `);
});

export default app;
