/**
 * Dev data reset — run with: npm run db:reset-dev
 *
 * Deletes all mock data created by POST /api/admin/mock-draft
 * (users with @mock.invalid emails and anything that cascades from them).
 * Leaves real demo users (@demo.com) and their seed data untouched.
 *
 * Safe to run repeatedly. Does NOT drop or alter any tables.
 */
import { pool } from '../config/database';
import dotenv from 'dotenv';

dotenv.config();

async function resetDev() {
  console.log('Resetting dev mock data...');

  // 1. Delete mock users — cascade removes their teams, rosters,
  //    draft_picks, draft_sessions (via leagues cascade), and leagues
  //    where they are commissioner.
  const { rowCount: usersDeleted } = await pool.query(
    `DELETE FROM users WHERE email LIKE '%@mock.invalid'`
  );
  console.log(`  Deleted ${usersDeleted ?? 0} mock users (and cascaded data)`);

  // 2. Delete any orphaned leagues that have no teams and no real commissioner.
  //    (Covers edge cases where a league was created but user cleanup missed it.)
  const { rowCount: leaguesDeleted } = await pool.query(
    `DELETE FROM leagues
     WHERE id NOT IN (SELECT DISTINCT league_id FROM teams WHERE league_id IS NOT NULL)
       AND commissioner_id NOT IN (SELECT id FROM users WHERE email LIKE '%@demo.com')`
  );
  console.log(`  Deleted ${leaguesDeleted ?? 0} orphaned leagues`);

  console.log('Reset complete.');
  await pool.end();
}

resetDev().catch((err) => {
  console.error('Reset failed:', err);
  process.exit(1);
});
