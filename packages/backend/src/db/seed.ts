/**
 * Demo seed — run with: npm run seed
 * Creates two demo leagues:
 *   1) "The No Fun League" — in_season with rosters, matchups, standings
 *   2) "Draft Day League"  — pre_draft, teams ready, no picks yet
 *
 * All passwords: password123
 * Users: commish / alice / bob / carol  (@demo.com)
 *
 * Re-runnable: skips if demo users already exist.
 * To re-seed: DELETE FROM users WHERE email LIKE '%@demo.com'; then re-run.
 */
import { pool } from '../config/database';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

// ── Players ──────────────────────────────────────────────────────────────────
const PLAYERS = [
  // QBs
  { id: 'DEMO-QB-1', full_name: 'Patrick Mahomes',   first: 'Patrick',   last: 'Mahomes',   pos: 'QB',  team: 'KC' },
  { id: 'DEMO-QB-2', full_name: 'Josh Allen',        first: 'Josh',      last: 'Allen',     pos: 'QB',  team: 'BUF' },
  { id: 'DEMO-QB-3', full_name: 'Jalen Hurts',       first: 'Jalen',     last: 'Hurts',     pos: 'QB',  team: 'PHI' },
  { id: 'DEMO-QB-4', full_name: 'Lamar Jackson',     first: 'Lamar',     last: 'Jackson',   pos: 'QB',  team: 'BAL' },
  // RBs
  { id: 'DEMO-RB-1', full_name: 'Christian McCaffrey',first:'Christian', last:'McCaffrey',  pos: 'RB',  team: 'SF' },
  { id: 'DEMO-RB-2', full_name: 'Saquon Barkley',    first: 'Saquon',    last: 'Barkley',   pos: 'RB',  team: 'PHI' },
  { id: 'DEMO-RB-3', full_name: 'Derrick Henry',     first: 'Derrick',   last: 'Henry',     pos: 'RB',  team: 'BAL' },
  { id: 'DEMO-RB-4', full_name: 'Breece Hall',       first: 'Breece',    last: 'Hall',      pos: 'RB',  team: 'NYJ' },
  { id: 'DEMO-RB-5', full_name: 'De\'Von Achane',    first: 'De\'Von',   last: 'Achane',    pos: 'RB',  team: 'MIA' },
  { id: 'DEMO-RB-6', full_name: 'James Cook',        first: 'James',     last: 'Cook',      pos: 'RB',  team: 'BUF' },
  { id: 'DEMO-RB-7', full_name: 'Travis Etienne',    first: 'Travis',    last: 'Etienne',   pos: 'RB',  team: 'JAX' },
  { id: 'DEMO-RB-8', full_name: 'Tony Pollard',      first: 'Tony',      last: 'Pollard',   pos: 'RB',  team: 'TEN' },
  // WRs
  { id: 'DEMO-WR-1', full_name: 'Tyreek Hill',       first: 'Tyreek',    last: 'Hill',      pos: 'WR',  team: 'MIA' },
  { id: 'DEMO-WR-2', full_name: 'CeeDee Lamb',       first: 'CeeDee',    last: 'Lamb',      pos: 'WR',  team: 'DAL' },
  { id: 'DEMO-WR-3', full_name: 'Davante Adams',     first: 'Davante',   last: 'Adams',     pos: 'WR',  team: 'LV' },
  { id: 'DEMO-WR-4', full_name: 'Stefon Diggs',      first: 'Stefon',    last: 'Diggs',     pos: 'WR',  team: 'HOU' },
  { id: 'DEMO-WR-5', full_name: 'Justin Jefferson',  first: 'Justin',    last: 'Jefferson', pos: 'WR',  team: 'MIN' },
  { id: 'DEMO-WR-6', full_name: 'Amon-Ra St. Brown', first: 'Amon-Ra',   last: 'St. Brown', pos: 'WR',  team: 'DET' },
  { id: 'DEMO-WR-7', full_name: 'Deebo Samuel',      first: 'Deebo',     last: 'Samuel',    pos: 'WR',  team: 'SF' },
  { id: 'DEMO-WR-8', full_name: 'Puka Nacua',        first: 'Puka',      last: 'Nacua',     pos: 'WR',  team: 'LAR' },
  // TEs
  { id: 'DEMO-TE-1', full_name: 'Travis Kelce',      first: 'Travis',    last: 'Kelce',     pos: 'TE',  team: 'KC' },
  { id: 'DEMO-TE-2', full_name: 'Mark Andrews',      first: 'Mark',      last: 'Andrews',   pos: 'TE',  team: 'BAL' },
  { id: 'DEMO-TE-3', full_name: 'Sam LaPorta',       first: 'Sam',       last: 'LaPorta',   pos: 'TE',  team: 'DET' },
  { id: 'DEMO-TE-4', full_name: 'Dallas Goedert',    first: 'Dallas',    last: 'Goedert',   pos: 'TE',  team: 'PHI' },
  // Ks
  { id: 'DEMO-K-1',  full_name: 'Justin Tucker',     first: 'Justin',    last: 'Tucker',    pos: 'K',   team: 'BAL' },
  { id: 'DEMO-K-2',  full_name: 'Harrison Butker',   first: 'Harrison',  last: 'Butker',    pos: 'K',   team: 'KC' },
  { id: 'DEMO-K-3',  full_name: 'Jake Elliott',      first: 'Jake',      last: 'Elliott',   pos: 'K',   team: 'PHI' },
  { id: 'DEMO-K-4',  full_name: 'Tyler Bass',        first: 'Tyler',     last: 'Bass',      pos: 'K',   team: 'BUF' },
  // DEFs
  { id: 'DEMO-DEF-KC',  full_name: 'Kansas City Chiefs', first: 'Kansas City', last: 'Chiefs',  pos: 'DEF', team: 'KC' },
  { id: 'DEMO-DEF-PHI', full_name: 'Philadelphia Eagles',first:'Philadelphia',last:'Eagles',   pos: 'DEF', team: 'PHI' },
  { id: 'DEMO-DEF-SF',  full_name: 'San Francisco 49ers', first:'San Francisco',last:'49ers',  pos: 'DEF', team: 'SF' },
  { id: 'DEMO-DEF-BAL', full_name: 'Baltimore Ravens',  first:'Baltimore', last:'Ravens',      pos: 'DEF', team: 'BAL' },
];

async function seed() {
  console.log('🌱 Seeding demo data...');

  // ── Skip if already seeded ─────────────────────────────────────────────────
  const { rows: existing } = await pool.query(
    `SELECT id FROM users WHERE email = 'commish@demo.com'`
  );
  if (existing.length > 0) {
    console.log('Demo data already exists. To re-seed, delete users with @demo.com emails.');
    await pool.end();
    return;
  }

  try {
    const hash = await bcrypt.hash('password123', 10);

    // ── 1. Users ───────────────────────────────────────────────────────────────
    await pool.query(`
      INSERT INTO users (username, email, password_hash, display_name, trash_talk_style) VALUES
        ('commish',  'commish@demo.com', $1, 'The Commissioner', 'aggressive'),
        ('alice',    'alice@demo.com',   $1, 'Alice',            'petty'),
        ('bob',      'bob@demo.com',     $1, 'Bob',              'poetic'),
        ('carol',    'carol@demo.com',   $1, 'Carol',            'aggressive')
      ON CONFLICT (email) DO NOTHING
    `, [hash]);
    console.log('  ✓ Users');

    const { rows: users } = await pool.query(
      `SELECT id, username FROM users WHERE email LIKE '%@demo.com' ORDER BY created_at`
    );
    const [commish, alice, bob, carol] = users;

    // ── 2. Players ─────────────────────────────────────────────────────────────
    for (const p of PLAYERS) {
      await pool.query(`
        INSERT INTO players (id, full_name, first_name, last_name, position, nfl_team, status, fantasy_positions)
        VALUES ($1, $2, $3, $4, $5, $6, 'Active', ARRAY[$7::text])
        ON CONFLICT (id) DO NOTHING
      `, [p.id, p.full_name, p.first, p.last, p.pos, p.team, p.pos]);
    }
    console.log(`  ✓ ${PLAYERS.length} players`);

    // ════════════════════════════════════════════════════════════════════════════
    // LEAGUE 1 — In-Season (populated standings, rosters, matchups)
    // ════════════════════════════════════════════════════════════════════════════
    const { rows: [league1] } = await pool.query(`
      INSERT INTO leagues (name, commissioner_id, season, status, week, ai_enabled)
      VALUES ('The No Fun League', $1, 2025, 'in_season', 1, TRUE)
      RETURNING id
    `, [commish.id]);
    const l1 = league1.id as string;

    // Teams with W/L records
    const { rows: [t1] } = await pool.query(`
      INSERT INTO teams (league_id, user_id, name, wins, losses, points_for, points_against)
      VALUES ($1, $2, 'Chaos Incarnate',   1, 0, 142.5,  98.2) RETURNING id
    `, [l1, commish.id]);

    const { rows: [t2] } = await pool.query(`
      INSERT INTO teams (league_id, user_id, name, wins, losses, points_for, points_against)
      VALUES ($1, $2, 'Alice''s Nightmares', 1, 0, 121.0, 105.7) RETURNING id
    `, [l1, alice.id]);

    const { rows: [t3] } = await pool.query(`
      INSERT INTO teams (league_id, user_id, name, wins, losses, points_for, points_against)
      VALUES ($1, $2, 'Bob''s Blunders',    0, 1,  98.2, 142.5) RETURNING id
    `, [l1, bob.id]);

    const { rows: [t4] } = await pool.query(`
      INSERT INTO teams (league_id, user_id, name, wins, losses, points_for, points_against)
      VALUES ($1, $2, 'Carol''s Chaos',     0, 1, 105.7, 121.0) RETURNING id
    `, [l1, carol.id]);

    const teamIds = [t1.id, t2.id, t3.id, t4.id];

    // Draft session (complete)
    const { rows: [ds1] } = await pool.query(`
      INSERT INTO draft_sessions
        (league_id, status, total_rounds, seconds_per_pick, current_pick, draft_order,
         started_at, completed_at, pick_started_at)
      VALUES ($1, 'complete', 4, 90, 17, $2, NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days', NULL)
      RETURNING id
    `, [l1, teamIds]);

    // Snake picks: R1→ T1 T2 T3 T4 | R2← T4 T3 T2 T1 | R3→ T1 T2 T3 T4 | R4← T4 T3 T2 T1
    const picks: { team: string; player: string; pick: number; round: number; pir: number }[] = [
      { pick: 1,  round: 1, pir: 1, team: t1.id, player: 'DEMO-QB-1' }, // Mahomes → commish
      { pick: 2,  round: 1, pir: 2, team: t2.id, player: 'DEMO-QB-2' }, // J.Allen → alice
      { pick: 3,  round: 1, pir: 3, team: t3.id, player: 'DEMO-QB-3' }, // Hurts   → bob
      { pick: 4,  round: 1, pir: 4, team: t4.id, player: 'DEMO-QB-4' }, // Lamar   → carol
      { pick: 5,  round: 2, pir: 1, team: t4.id, player: 'DEMO-RB-1' }, // McCaffrey → carol
      { pick: 6,  round: 2, pir: 2, team: t3.id, player: 'DEMO-RB-2' }, // Barkley   → bob
      { pick: 7,  round: 2, pir: 3, team: t2.id, player: 'DEMO-RB-3' }, // D.Henry   → alice
      { pick: 8,  round: 2, pir: 4, team: t1.id, player: 'DEMO-RB-4' }, // B.Hall    → commish
      { pick: 9,  round: 3, pir: 1, team: t1.id, player: 'DEMO-WR-1' }, // T.Hill    → commish
      { pick: 10, round: 3, pir: 2, team: t2.id, player: 'DEMO-WR-2' }, // CeeDee    → alice
      { pick: 11, round: 3, pir: 3, team: t3.id, player: 'DEMO-WR-3' }, // D.Adams   → bob
      { pick: 12, round: 3, pir: 4, team: t4.id, player: 'DEMO-WR-5' }, // Jefferson → carol
      { pick: 13, round: 4, pir: 1, team: t4.id, player: 'DEMO-TE-1' }, // Kelce     → carol
      { pick: 14, round: 4, pir: 2, team: t3.id, player: 'DEMO-TE-2' }, // Andrews   → bob
      { pick: 15, round: 4, pir: 3, team: t2.id, player: 'DEMO-TE-3' }, // LaPorta   → alice
      { pick: 16, round: 4, pir: 4, team: t1.id, player: 'DEMO-TE-4' }, // Goedert   → commish
    ];

    for (const p of picks) {
      await pool.query(`
        INSERT INTO draft_picks
          (session_id, league_id, team_id, player_id, overall_pick, round, pick_in_round)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT DO NOTHING
      `, [ds1.id, l1, p.team, p.player, p.pick, p.round, p.pir]);

      await pool.query(`
        INSERT INTO rosters (team_id, player_id, acquisition_type, acquisition_week, is_starter)
        VALUES ($1, $2, 'draft', 1, FALSE)
        ON CONFLICT (team_id, player_id) DO NOTHING
      `, [p.team, p.player]);
    }
    console.log('  ✓ Draft picks & rosters');

    // Add K and DEF to each team (not from draft, just seed them)
    const extras: [string, string][] = [
      [t1.id, 'DEMO-K-1'],   [t1.id, 'DEMO-DEF-SF'],
      [t2.id, 'DEMO-K-2'],   [t2.id, 'DEMO-DEF-PHI'],
      [t3.id, 'DEMO-K-3'],   [t3.id, 'DEMO-DEF-KC'],
      [t4.id, 'DEMO-K-4'],   [t4.id, 'DEMO-DEF-BAL'],
    ];
    for (const [tid, pid] of extras) {
      await pool.query(`
        INSERT INTO rosters (team_id, player_id, acquisition_type, acquisition_week, is_starter)
        VALUES ($1, $2, 'draft', 1, FALSE)
        ON CONFLICT (team_id, player_id) DO NOTHING
      `, [tid, pid]);
    }

    // Matchups (week 1, complete)
    await pool.query(`
      INSERT INTO matchups
        (league_id, week, home_team_id, away_team_id, home_score, away_score,
         winner_team_id, is_complete)
      VALUES
        ($1, 1, $2, $3, 142.5,  98.2, $2, TRUE),
        ($1, 1, $4, $5, 121.0, 105.7, $4, TRUE)
      ON CONFLICT DO NOTHING
    `, [l1, t1.id, t3.id, t2.id, t4.id]);
    console.log('  ✓ Matchups');

    console.log(`  ✓ League 1 created: "The No Fun League" [${l1}]`);

    // ════════════════════════════════════════════════════════════════════════════
    // LEAGUE 2 — Pre-Draft (ready to start a live draft demo)
    // ════════════════════════════════════════════════════════════════════════════
    const { rows: [league2] } = await pool.query(`
      INSERT INTO leagues (name, commissioner_id, season, status, week, ai_enabled)
      VALUES ('Draft Day League', $1, 2025, 'pre_draft', 1, TRUE)
      RETURNING id
    `, [commish.id]);
    const l2 = league2.id as string;

    await pool.query(`
      INSERT INTO teams (league_id, user_id, name) VALUES
        ($1, $2, 'Commish Squad'),
        ($1, $3, 'Alice FC'),
        ($1, $4, 'Bob United'),
        ($1, $5, 'Carol Athletics')
    `, [l2, commish.id, alice.id, bob.id, carol.id]);

    console.log(`  ✓ League 2 created: "Draft Day League" [${l2}]`);

    console.log('\n✅ Seed complete!\n');
    console.log('  Logins (all password: password123)');
    console.log('  ─────────────────────────────────────────');
    console.log('  commish@demo.com  — commissioner of both leagues');
    console.log('  alice@demo.com    — player in both leagues');
    console.log('  bob@demo.com      — player in both leagues');
    console.log('  carol@demo.com    — player in both leagues');
    console.log('\n  League 1 "The No Fun League" — in_season, week 1, matchups visible');
    console.log('  League 2 "Draft Day League"  — pre_draft, start a live draft');

  } catch (err) {
    console.error('Seed failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seed();
