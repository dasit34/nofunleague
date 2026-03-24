import { pool } from '../config/database';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

async function seed() {
  console.log('Seeding database...');
  try {
    // Create demo users
    const hash = await bcrypt.hash('password123', 10);
    await pool.query(`
      INSERT INTO users (username, email, password_hash, display_name, trash_talk_style)
      VALUES
        ('commissioner', 'commissioner@nofunleague.com', $1, 'The Commissioner', 'aggressive'),
        ('demo_user', 'demo@nofunleague.com', $1, 'Demo Manager', 'petty')
      ON CONFLICT (email) DO NOTHING
    `, [hash]);

    // Create demo league
    const { rows: [commish] } = await pool.query(`SELECT id FROM users WHERE username = 'commissioner'`);
    await pool.query(`
      INSERT INTO leagues (name, commissioner_id, season, ai_enabled)
      VALUES ('The No Fun League', $1, 2025, TRUE)
      ON CONFLICT DO NOTHING
    `, [commish.id]);

    console.log('Seed complete.');
  } catch (err) {
    console.error('Seed failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seed();
