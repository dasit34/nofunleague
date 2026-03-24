import fs from 'fs';
import path from 'path';
import { pool } from '../config/database';
import dotenv from 'dotenv';

dotenv.config();

async function migrate() {
  console.log('Running database migrations...');

  try {
    // 1. Create migration tracking table first (idempotent)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(100) PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // 2. Run base schema (all statements use IF NOT EXISTS / CREATE OR REPLACE)
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    await pool.query(schema);
    console.log('Base schema applied.');

    // 3. Run ordered migration files
    const migrationsDir = path.join(__dirname, 'migrations');
    if (fs.existsSync(migrationsDir)) {
      const files = fs
        .readdirSync(migrationsDir)
        .filter((f) => f.endsWith('.sql'))
        .sort(); // alphabetical = chronological with numbered prefixes

      for (const file of files) {
        const version = file.replace('.sql', '');
        const { rows } = await pool.query(
          'SELECT version FROM schema_migrations WHERE version = $1',
          [version]
        );

        if (rows.length > 0) {
          console.log(`  Skipping ${version} (already applied)`);
          continue;
        }

        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
        await pool.query(sql);
        await pool.query(
          'INSERT INTO schema_migrations (version) VALUES ($1)',
          [version]
        );
        console.log(`  Applied: ${version}`);
      }
    }

    console.log('Migration complete.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
