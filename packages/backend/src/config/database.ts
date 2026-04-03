import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Enable SSL for any non-localhost connection (Railway, Render, Neon, etc.).
// Local Docker postgres doesn't support SSL, so skip it for localhost/127.0.0.1.
const isLocalDb = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '');

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocalDb ? false : { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

export async function query(text: string, params?: unknown[]) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (process.env.NODE_ENV === 'development') {
    console.log('query', { text, duration, rows: res.rowCount });
  }
  return res;
}

export async function getClient() {
  return pool.connect();
}
