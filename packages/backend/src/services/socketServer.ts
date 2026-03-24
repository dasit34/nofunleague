import http from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { query } from '../config/database';
import { DraftEngine } from './draftEngine';

// =============================================
// Active draft engine registry
// =============================================

const engines = new Map<string, DraftEngine>();

export function getEngine(sessionId: string): DraftEngine | undefined {
  return engines.get(sessionId);
}

async function getOrCreateEngine(sessionId: string, io: Server): Promise<DraftEngine | null> {
  if (engines.has(sessionId)) return engines.get(sessionId)!;

  const { rows: [session] } = await query(
    'SELECT id, status FROM draft_sessions WHERE id = $1',
    [sessionId]
  );
  if (!session) return null;
  if (session.status === 'complete') return null; // no engine needed for finished drafts

  const engine = new DraftEngine(sessionId, io);
  engines.set(sessionId, engine);

  // If it was mid-pick when server restarted, pause it so commissioner can review
  if (session.status === 'active') {
    await query(
      `UPDATE draft_sessions SET status = 'paused', paused_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [sessionId]
    );
  }

  return engine;
}

function removeEngine(sessionId: string): void {
  engines.get(sessionId)?.destroy();
  engines.delete(sessionId);
}

// =============================================
// Socket.IO server initialisation
// =============================================

export function initSocketServer(httpServer: http.Server): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:3000',
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  // ── Auth middleware — runs before every connection ────────────────────
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) { next(new Error('NO_TOKEN')); return; }
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET!) as {
        id: string; username: string; email: string;
      };
      socket.data.user = payload;
      next();
    } catch {
      next(new Error('INVALID_TOKEN'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const userId = socket.data.user?.id as string;
    console.log(`[socket] Connected: ${socket.id}  user=${userId}`);

    // ── draft:join ─────────────────────────────────────────────────────
    socket.on('draft:join', async ({ sessionId }: { sessionId: string }) => {
      try {
        const engine = await getOrCreateEngine(sessionId, io);
        if (!engine) {
          socket.emit('draft:error', { message: 'Draft session not found or already complete' });
          return;
        }

        socket.join(engine.room);
        socket.data.sessionId = sessionId;

        // Resolve caller's team in this league
        const session = await engine.getSession();
        const { rows: [team] } = await query(
          'SELECT id FROM teams WHERE league_id = $1 AND user_id = $2 LIMIT 1',
          [session.league_id, userId]
        );
        socket.data.teamId = team?.id ?? null;

        const state = await engine.getState();
        socket.emit('draft:state', state);

        console.log(`[socket] ${userId} joined draft ${sessionId} (team=${socket.data.teamId ?? 'spectator'})`);
      } catch (err) {
        console.error('[socket] draft:join error:', err);
        socket.emit('draft:error', { message: 'Failed to join draft room' });
      }
    });

    // ── draft:start (commissioner) ─────────────────────────────────────
    socket.on('draft:start', async () => {
      const { sessionId } = socket.data;
      if (!sessionId) return;

      try {
        const engine = await getOrCreateEngine(sessionId, io);
        if (!engine) { socket.emit('draft:error', { message: 'Session not found' }); return; }

        await assertCommissioner(socket, engine);
        await engine.start();
      } catch (err) {
        socket.emit('draft:error', { message: (err as Error).message });
      }
    });

    // ── draft:pick ─────────────────────────────────────────────────────
    socket.on('draft:pick', async ({ playerId }: { playerId: string }) => {
      const { sessionId, teamId } = socket.data;
      if (!sessionId || !teamId) {
        socket.emit('draft:error', { message: 'Not in a draft room or no team assigned' });
        return;
      }

      const engine = getEngine(sessionId);
      if (!engine) { socket.emit('draft:error', { message: 'Draft engine not running' }); return; }

      try {
        await engine.makePick(teamId, playerId, false);
      } catch (err) {
        socket.emit('draft:error', { message: (err as Error).message });
      }
    });

    // ── draft:pause (commissioner) ─────────────────────────────────────
    socket.on('draft:pause', async () => {
      const { sessionId } = socket.data;
      if (!sessionId) return;

      const engine = getEngine(sessionId);
      if (!engine) return;

      try {
        await assertCommissioner(socket, engine);
        await engine.pause(userId);
      } catch (err) {
        socket.emit('draft:error', { message: (err as Error).message });
      }
    });

    // ── draft:resume (commissioner) ────────────────────────────────────
    socket.on('draft:resume', async () => {
      const { sessionId } = socket.data;
      if (!sessionId) return;

      const engine = getEngine(sessionId);
      if (!engine) return;

      try {
        await assertCommissioner(socket, engine);
        await engine.resume();
      } catch (err) {
        socket.emit('draft:error', { message: (err as Error).message });
      }
    });

    socket.on('disconnect', () => {
      console.log(`[socket] Disconnected: ${socket.id}`);
    });
  });

  // On startup, pause any sessions that were left 'active' (server restart)
  pauseStuckSessions().catch((err) =>
    console.error('[socket] Failed to pause stuck sessions on startup:', err)
  );

  console.log('[socket] Socket.IO server initialised');
  return io;
}

// =============================================
// Helpers
// =============================================

async function assertCommissioner(socket: Socket, engine: DraftEngine): Promise<void> {
  const session = await engine.getSession();
  const { rows: [league] } = await query(
    'SELECT commissioner_id FROM leagues WHERE id = $1',
    [session.league_id]
  );
  if (league?.commissioner_id !== socket.data.user.id) {
    throw new Error('Only the commissioner can perform this action');
  }
}

async function pauseStuckSessions(): Promise<void> {
  const { rows } = await query(
    `UPDATE draft_sessions
     SET status = 'paused', paused_at = NOW(), updated_at = NOW()
     WHERE status = 'active'
     RETURNING id`
  );
  if (rows.length > 0) {
    console.log(`[socket] Paused ${rows.length} active session(s) found on startup (server was restarted mid-draft)`);
  }
}
