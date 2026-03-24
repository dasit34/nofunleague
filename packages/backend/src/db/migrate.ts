import fs from 'fs';
import path from 'path';
import { pool } from '../config/database';
import dotenv from 'dotenv';

dotenv.config();

async function migrate() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');

  console.log('Running database migration...');
  try {
    await pool.query(schema);
    console.log('Migration complete.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
