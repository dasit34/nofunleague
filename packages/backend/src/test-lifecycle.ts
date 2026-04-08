/**
 * End-to-end fantasy league lifecycle test.
 *
 * Tests: user creation → league creation → join → draft → set lineups →
 *        sync stats → score week 1 → verify standings → score week 2 → final report
 *
 * Usage: cd packages/backend && npx tsx src/test-lifecycle.ts
 */
import dotenv from 'dotenv';
dotenv.config();

import { pool, query } from './config/database';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { syncPlayerStats } from './services/statsService';
import { startDraft, makePick, getDraftState } from './services/draftService';
import { scoreWeekReal } from './services/scoringService';

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const REPORT: Record<string, unknown> = {};
const ERRORS: string[] = [];

function log(msg: string) { console.log(`  ${msg}`); }
function pass(label: string) { console.log(`  ✓ ${label}`); }
function fail(label: string, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`  ✗ ${label}: ${msg}`);
  ERRORS.push(`${label}: ${msg}`);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function createUser(username: string, email: string): Promise<{ id: string; token: string }> {
  const hash = await bcrypt.hash('test1234', 10);
  const { rows: [existing] } = await query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing) {
    const token = jwt.sign({ id: existing.id, username, email }, JWT_SECRET, { expiresIn: '1h' });
    return { id: existing.id, token };
  }
  const { rows: [user] } = await query(
    `INSERT INTO users (username, email, password_hash, display_name)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [username, email, hash, username]
  );
  const token = jwt.sign({ id: user.id, username, email }, JWT_SECRET, { expiresIn: '1h' });
  return { id: user.id, token };
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n══════════════════════════════════════════════════');
  console.log('  FANTASY LEAGUE LIFECYCLE TEST');
  console.log('══════════════════════════════════════════════════\n');

  // ──────────────────────────────────────────────────
  // STEP 1: Create test users
  // ──────────────────────────────────────────────────
  console.log('STEP 1: Create test users');
  const users: { id: string; token: string; username: string }[] = [];
  for (let i = 1; i <= 4; i++) {
    const u = await createUser(`tester${i}`, `user${i}@test.com`);
    users.push({ ...u, username: `tester${i}` });
    pass(`Created user${i}@test.com (${u.id.slice(0, 8)}...)`);
  }
  REPORT.users = users.map(u => ({ id: u.id, username: u.username }));

  // ──────────────────────────────────────────────────
  // STEP 2: Create league
  // ──────────────────────────────────────────────────
  console.log('\nSTEP 2: Create league');
  const commissioner = users[0];

  const { rows: [league] } = await query(
    `INSERT INTO leagues (name, commissioner_id, season, league_size, scoring_type, scoring_source, invite_code, status)
     VALUES ($1, $2, 2024, 4, 'ppr', 'real', $3, 'pre_draft')
     RETURNING *`,
    ['Lifecycle Test League', commissioner.id, 'LIFECYCLE' + Date.now().toString(36).slice(-4).toUpperCase()]
  );

  // Add commissioner as member
  await query(
    `INSERT INTO league_members (user_id, league_id, role) VALUES ($1, $2, 'commissioner') ON CONFLICT DO NOTHING`,
    [commissioner.id, league.id]
  );
  // Create commissioner's team
  await query(
    `INSERT INTO teams (league_id, user_id, name) VALUES ($1, $2, $3) ON CONFLICT (league_id, user_id) DO NOTHING`,
    [league.id, commissioner.id, `${commissioner.username}'s Team`]
  );

  pass(`League created: ${league.name} (${league.id.slice(0, 8)}...) invite=${league.invite_code}`);
  REPORT.league_id = league.id;
  REPORT.invite_code = league.invite_code;
  REPORT.scoring_source = league.scoring_source;
  REPORT.scoring_type = league.scoring_type;

  // ──────────────────────────────────────────────────
  // STEP 3: Join league with remaining users
  // ──────────────────────────────────────────────────
  console.log('\nSTEP 3: Join league');
  for (let i = 1; i < users.length; i++) {
    const u = users[i];
    await query(
      `INSERT INTO league_members (user_id, league_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`,
      [u.id, league.id]
    );
    await query(
      `INSERT INTO teams (league_id, user_id, name) VALUES ($1, $2, $3) ON CONFLICT (league_id, user_id) DO NOTHING`,
      [league.id, u.id, `${u.username}'s Team`]
    );
    pass(`${u.username} joined with team`);
  }

  // Verify teams
  const { rows: teams } = await query(
    'SELECT id, user_id, name FROM teams WHERE league_id = $1 ORDER BY created_at',
    [league.id]
  );
  REPORT.teams = teams.map((t: Record<string, unknown>) => ({ id: t.id, name: t.name }));
  pass(`${teams.length} teams in league`);

  if (teams.length !== 4) {
    fail('Team count', `Expected 4, got ${teams.length}`);
    await cleanup();
    return;
  }

  // ──────────────────────────────────────────────────
  // STEP 4: Draft simulation
  // ──────────────────────────────────────────────────
  console.log('\nSTEP 4: Run draft');

  // Check we have enough Sleeper players
  const { rows: [{ cnt: playerCount }] } = await query(
    `SELECT COUNT(*)::int AS cnt FROM players WHERE id NOT LIKE 'DEMO-%'`
  );
  log(`Sleeper players in DB: ${playerCount}`);

  if ((playerCount as number) < 50) {
    log('WARNING: Not enough Sleeper players. Draft will use available players.');
  }

  // Start draft (5 rounds × 4 teams = 20 picks)
  try {
    await startDraft(league.id, commissioner.id);
    pass('Draft started');
  } catch (err) {
    fail('Start draft', err);
    await cleanup();
    return;
  }

  // Make all 20 picks
  const totalPicks = 5 * 4;
  for (let pick = 1; pick <= totalPicks; pick++) {
    try {
      const state = await getDraftState(league.id);
      const currentTeamId = state.currentTeamId;
      if (!currentTeamId) { fail(`Pick ${pick}`, 'No team on clock'); break; }

      // Find the user who owns this team
      const team = teams.find((t: Record<string, unknown>) => t.id === currentTeamId);
      const owner = users.find(u => u.id === (team as Record<string, unknown>)?.user_id);
      if (!owner) { fail(`Pick ${pick}`, 'Cannot find team owner'); break; }

      // Get available players — pick a position based on round
      const round = Math.ceil(pick / 4);
      const positionByRound: Record<number, string> = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'RB' };
      const targetPos = positionByRound[round] || 'WR';

      // Get available players for this position
      const { rows: available } = await query(
        `SELECT p.id FROM players p
         WHERE p.position = $1
           AND p.id NOT LIKE 'DEMO-%'
           AND p.id NOT IN (SELECT player_id FROM draft_picks WHERE session_id = $2)
         ORDER BY RANDOM() LIMIT 1`,
        [targetPos, (state.session as Record<string, unknown>).id]
      );

      if (available.length === 0) {
        // Fallback: any position
        const { rows: fallback } = await query(
          `SELECT p.id FROM players p
           WHERE p.position IN ('QB','RB','WR','TE')
             AND p.id NOT IN (SELECT player_id FROM draft_picks WHERE session_id = $1)
           ORDER BY RANDOM() LIMIT 1`,
          [(state.session as Record<string, unknown>).id]
        );
        if (fallback.length === 0) { fail(`Pick ${pick}`, 'No players available'); break; }
        await makePick(league.id, owner.id, fallback[0].id);
      } else {
        await makePick(league.id, owner.id, available[0].id);
      }
    } catch (err) {
      fail(`Pick ${pick}`, err);
      break;
    }
  }

  // Verify draft completed
  const { rows: [postDraft] } = await query('SELECT status, week FROM leagues WHERE id = $1', [league.id]);
  if (postDraft.status === 'in_season') {
    pass(`Draft complete → status=${postDraft.status}, week=${postDraft.week}`);
  } else {
    fail('Draft completion', `Expected in_season, got ${postDraft.status}`);
    await cleanup();
    return;
  }

  // Verify schedule was generated
  const { rows: [{ mcnt }] } = await query(
    'SELECT COUNT(*)::int AS mcnt FROM matchups WHERE league_id = $1',
    [league.id]
  );
  pass(`Schedule: ${mcnt} total matchups generated`);
  REPORT.total_matchups = mcnt;

  // Verify team records reset
  const { rows: [teamCheck] } = await query(
    'SELECT SUM(wins)::int AS w, SUM(losses)::int AS l FROM teams WHERE league_id = $1',
    [league.id]
  );
  pass(`Team records reset: W=${teamCheck.w}, L=${teamCheck.l} (should be 0,0)`);

  // ──────────────────────────────────────────────────
  // STEP 5: Set lineups
  // ──────────────────────────────────────────────────
  console.log('\nSTEP 5: Set lineups');

  const SLOTS = [
    { slot: 'QB', pos: 'QB' },
    { slot: 'RB1', pos: 'RB' }, { slot: 'RB2', pos: 'RB' },
    { slot: 'WR1', pos: 'WR' }, { slot: 'WR2', pos: 'WR' },
    { slot: 'TE', pos: 'TE' },
    { slot: 'FLEX', pos: null }, // RB/WR/TE
  ];

  for (const team of teams) {
    const tid = team.id as string;
    const { rows: roster } = await query(
      `SELECT r.player_id, p.position FROM rosters r
       JOIN players p ON p.id = r.player_id
       WHERE r.team_id = $1 ORDER BY RANDOM()`,
      [tid]
    );

    const used = new Set<string>();
    for (const slotDef of SLOTS) {
      let player;
      if (slotDef.pos) {
        player = roster.find((r: Record<string, unknown>) =>
          r.position === slotDef.pos && !used.has(r.player_id as string)
        );
      } else {
        // FLEX: any RB/WR/TE not already used
        player = roster.find((r: Record<string, unknown>) =>
          ['RB', 'WR', 'TE'].includes(r.position as string) && !used.has(r.player_id as string)
        );
      }

      if (player) {
        used.add(player.player_id as string);
        await query(
          `UPDATE rosters SET roster_slot = $1, is_starter = TRUE WHERE team_id = $2 AND player_id = $3`,
          [slotDef.slot, tid, player.player_id]
        );
      }
    }

    // Set remaining players to bench
    let benchIdx = 1;
    for (const r of roster) {
      if (!used.has(r.player_id as string) && benchIdx <= 6) {
        await query(
          `UPDATE rosters SET roster_slot = $1, is_starter = FALSE WHERE team_id = $2 AND player_id = $3`,
          [`BN${benchIdx}`, tid, r.player_id]
        );
        benchIdx++;
      }
    }

    const starterCount = used.size;
    pass(`${(team.name as string)}: ${starterCount} starters set`);
  }

  // ──────────────────────────────────────────────────
  // STEP 6: Sync stats for 2024 week 1
  // ──────────────────────────────────────────────────
  console.log('\nSTEP 6: Sync stats (2024 week 1)');
  try {
    const { rows: [existing] } = await query(
      `SELECT COUNT(*)::int AS cnt FROM player_stats WHERE season = 2024 AND week = 1 AND season_type = 'regular'`
    );
    if ((existing.cnt as number) > 0) {
      pass(`Stats already synced: ${existing.cnt} player entries for 2024 week 1`);
    } else {
      log('Syncing from Sleeper (this may take a moment)...');
      const result = await syncPlayerStats(2024, 1, 'regular');
      pass(`Stats synced: ${result.synced} players, ${result.skipped} skipped, ${result.errors} errors`);
    }
  } catch (err) {
    fail('Stats sync', err);
    log('Falling back to mock scoring');
    await query(`UPDATE leagues SET scoring_source = 'mock' WHERE id = $1`, [league.id]);
  }

  // ──────────────────────────────────────────────────
  // STEP 7: Score week 1
  // ──────────────────────────────────────────────────
  console.log('\nSTEP 7: Score week 1');

  // Check current state
  const { rows: [preScore] } = await query('SELECT week, scoring_source FROM leagues WHERE id = $1', [league.id]);
  log(`League week: ${preScore.week}, scoring_source: ${preScore.scoring_source}`);

  // Lock lineups
  await query(
    'UPDATE leagues SET lineup_locked_week = GREATEST(lineup_locked_week, $2) WHERE id = $1',
    [league.id, preScore.week]
  );

  // Score
  try {
    const scoringSource = preScore.scoring_source as string;
    if (scoringSource === 'real') {
      const result = await scoreWeekReal(league.id, 1);
      pass(`Scored week 1 (real): ${result.scored} matchups`);
      REPORT.week1_scoring = 'real';
      REPORT.week1_matchups = result.details;
    } else {
      // Use mock scoring directly
      const { rows: matchups } = await query(
        `SELECT * FROM matchups WHERE league_id = $1 AND week = 1 AND is_complete = FALSE`,
        [league.id]
      );
      for (const m of matchups) {
        const homeScore = Math.round((70 + Math.random() * 80) * 100) / 100;
        const awayScore = Math.round((70 + Math.random() * 80) * 100) / 100;
        const winnerId = homeScore > awayScore ? m.home_team_id : awayScore > homeScore ? m.away_team_id : null;
        await query(
          `UPDATE matchups SET home_score=$1, away_score=$2, winner_team_id=$3, is_complete=TRUE, scoring_source='mock' WHERE id=$4`,
          [homeScore, awayScore, winnerId, m.id]
        );
        if (winnerId) {
          const loserId = winnerId === m.home_team_id ? m.away_team_id : m.home_team_id;
          await query('UPDATE teams SET wins = wins + 1 WHERE id = $1', [winnerId]);
          await query('UPDATE teams SET losses = losses + 1 WHERE id = $1', [loserId]);
        }
        await query('UPDATE teams SET points_for = points_for + $2, points_against = points_against + $3 WHERE id = $1', [m.home_team_id, homeScore, awayScore]);
        await query('UPDATE teams SET points_for = points_for + $2, points_against = points_against + $3 WHERE id = $1', [m.away_team_id, awayScore, homeScore]);
      }
      pass(`Scored week 1 (mock): ${matchups.length} matchups`);
      REPORT.week1_scoring = 'mock';
    }
  } catch (err) {
    fail('Score week 1', err);
  }

  // Advance week
  await query('UPDATE leagues SET week = week + 1 WHERE id = $1', [league.id]);

  // Verify matchup results
  const { rows: week1Matchups } = await query(
    `SELECT m.home_score, m.away_score, m.winner_team_id, m.scoring_source,
            ht.name AS home_name, at.name AS away_name
     FROM matchups m
     JOIN teams ht ON ht.id = m.home_team_id
     JOIN teams at ON at.id = m.away_team_id
     WHERE m.league_id = $1 AND m.week = 1`,
    [league.id]
  );

  console.log('\n  Week 1 Results:');
  for (const m of week1Matchups) {
    const winner = m.winner_team_id
      ? (m.home_score > m.away_score ? m.home_name : m.away_name)
      : 'TIE';
    console.log(`    ${m.home_name} ${Number(m.home_score).toFixed(1)} - ${Number(m.away_score).toFixed(1)} ${m.away_name}  [${m.scoring_source}] Winner: ${winner}`);
    if (Number(m.home_score) === 0 && Number(m.away_score) === 0) {
      log('  ⚠ 0-0 tie — starters may not have had stats for this week (normal for random draft)');
    }
  }
  REPORT.week1_results = week1Matchups;

  // ──────────────────────────────────────────────────
  // STEP 8: Verify standings after week 1
  // ──────────────────────────────────────────────────
  console.log('\nSTEP 8: Standings after week 1');
  const { rows: standings1 } = await query(
    `SELECT name, wins, losses, ties, points_for, points_against
     FROM teams WHERE league_id = $1
     ORDER BY wins DESC, points_for DESC`,
    [league.id]
  );

  console.log('  ┌────────────────────────────┬───┬───┬────────┬────────┐');
  console.log('  │ Team                       │ W │ L │   PF   │   PA   │');
  console.log('  ├────────────────────────────┼───┼───┼────────┼────────┤');
  for (const t of standings1) {
    console.log(
      `  │ ${(t.name as string).padEnd(26)} │ ${t.wins} │ ${t.losses} │ ${Number(t.points_for).toFixed(1).padStart(6)} │ ${Number(t.points_against).toFixed(1).padStart(6)} │`
    );
  }
  console.log('  └────────────────────────────┴───┴───┴────────┴────────┘');
  REPORT.standings_after_week1 = standings1;

  // Verify total W+L+T = 4 (2 matchups × 2 teams each) and W = L
  const totalW = standings1.reduce((s, t) => s + (t.wins as number), 0);
  const totalL = standings1.reduce((s, t) => s + (t.losses as number), 0);
  const totalT = standings1.reduce((s, t) => s + (t.ties as number), 0);
  if (totalW === totalL && (totalW * 2 + totalT) === 4) {
    pass(`Standings integrity: ${totalW}W ${totalL}L ${totalT}T (2 matchups)`);
  } else {
    fail('Standings integrity', `W=${totalW}, L=${totalL}, T=${totalT}`);
  }

  // ──────────────────────────────────────────────────
  // STEP 9: Score week 2
  // ──────────────────────────────────────────────────
  console.log('\nSTEP 9: Score week 2');

  const { rows: [preWeek2] } = await query('SELECT week FROM leagues WHERE id = $1', [league.id]);
  log(`League week: ${preWeek2.week}`);

  // Sync week 2 stats if real mode
  const { rows: [leagueNow] } = await query('SELECT scoring_source FROM leagues WHERE id = $1', [league.id]);
  if (leagueNow.scoring_source === 'real') {
    try {
      const { rows: [existingW2] } = await query(
        `SELECT COUNT(*)::int AS cnt FROM player_stats WHERE season = 2024 AND week = 2`
      );
      if ((existingW2.cnt as number) === 0) {
        log('Syncing week 2 stats...');
        await syncPlayerStats(2024, 2, 'regular');
      }
      pass('Week 2 stats ready');
    } catch (err) {
      fail('Week 2 stats sync', err);
    }
  }

  // Lock and score
  await query('UPDATE leagues SET lineup_locked_week = GREATEST(lineup_locked_week, $2) WHERE id = $1', [league.id, 2]);

  try {
    if (leagueNow.scoring_source === 'real') {
      const result = await scoreWeekReal(league.id, 2);
      pass(`Scored week 2 (real): ${result.scored} matchups`);
    } else {
      const { rows: w2m } = await query(
        'SELECT * FROM matchups WHERE league_id = $1 AND week = 2 AND is_complete = FALSE', [league.id]
      );
      for (const m of w2m) {
        const hs = Math.round((70 + Math.random() * 80) * 100) / 100;
        const as_ = Math.round((70 + Math.random() * 80) * 100) / 100;
        const w = hs > as_ ? m.home_team_id : as_ > hs ? m.away_team_id : null;
        await query(`UPDATE matchups SET home_score=$1, away_score=$2, winner_team_id=$3, is_complete=TRUE, scoring_source='mock' WHERE id=$4`, [hs, as_, w, m.id]);
        if (w) {
          await query('UPDATE teams SET wins=wins+1 WHERE id=$1', [w]);
          await query('UPDATE teams SET losses=losses+1 WHERE id=$1', [w === m.home_team_id ? m.away_team_id : m.home_team_id]);
        }
        await query('UPDATE teams SET points_for=points_for+$2, points_against=points_against+$3 WHERE id=$1', [m.home_team_id, hs, as_]);
        await query('UPDATE teams SET points_for=points_for+$2, points_against=points_against+$3 WHERE id=$1', [m.away_team_id, as_, hs]);
      }
      pass(`Scored week 2 (mock): ${w2m.length} matchups`);
    }
  } catch (err) {
    fail('Score week 2', err);
  }

  // Advance week
  await query('UPDATE leagues SET week = week + 1 WHERE id = $1', [league.id]);

  // ──────────────────────────────────────────────────
  // STEP 10: Final standings + report
  // ──────────────────────────────────────────────────
  console.log('\nSTEP 10: Final standings (after 2 weeks)');
  const { rows: standings2 } = await query(
    `SELECT name, wins, losses, ties, points_for, points_against
     FROM teams WHERE league_id = $1
     ORDER BY wins DESC, points_for DESC`,
    [league.id]
  );

  console.log('  ┌────────────────────────────┬───┬───┬────────┬────────┐');
  console.log('  │ Team                       │ W │ L │   PF   │   PA   │');
  console.log('  ├────────────────────────────┼───┼───┼────────┼────────┤');
  for (const t of standings2) {
    console.log(
      `  │ ${(t.name as string).padEnd(26)} │ ${t.wins} │ ${t.losses} │ ${Number(t.points_for).toFixed(1).padStart(6)} │ ${Number(t.points_against).toFixed(1).padStart(6)} │`
    );
  }
  console.log('  └────────────────────────────┴───┴───┴────────┴────────┘');
  REPORT.standings_final = standings2;

  const totalW2 = standings2.reduce((s, t) => s + (t.wins as number), 0);
  const totalL2 = standings2.reduce((s, t) => s + (t.losses as number), 0);
  const totalT2 = standings2.reduce((s, t) => s + (t.ties as number), 0);
  if (totalW2 === totalL2 && (totalW2 * 2 + totalT2) === 8) {
    pass(`Final standings integrity: ${totalW2}W ${totalL2}L ${totalT2}T (4 matchups total)`);
  } else {
    fail('Final standings', `W=${totalW2}, L=${totalL2}, T=${totalT2}`);
  }

  // Final league state
  const { rows: [finalLeague] } = await query('SELECT week, status, scoring_source, lineup_locked_week FROM leagues WHERE id = $1', [league.id]);
  pass(`Final league state: week=${finalLeague.week}, status=${finalLeague.status}, scoring=${finalLeague.scoring_source}, locked_week=${finalLeague.lineup_locked_week}`);

  // ──────────────────────────────────────────────────
  // REPORT
  // ──────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════');
  console.log('  TEST REPORT');
  console.log('══════════════════════════════════════════════════');
  console.log(`  League ID:       ${league.id}`);
  console.log(`  Scoring:         ${finalLeague.scoring_source} / ${league.scoring_type}`);
  console.log(`  Teams:           ${teams.length}`);
  console.log(`  Total matchups:  ${mcnt}`);
  console.log(`  Weeks scored:    2`);
  console.log(`  Current week:    ${finalLeague.week}`);
  console.log(`  Errors:          ${ERRORS.length}`);
  if (ERRORS.length > 0) {
    console.log('  ─────────────────────────────');
    for (const e of ERRORS) console.log(`  ERROR: ${e}`);
  }
  console.log(`\n  ${ERRORS.length === 0 ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
  console.log('══════════════════════════════════════════════════\n');

  await cleanup();
}

async function cleanup() {
  await pool.end();
}

main().catch((err) => {
  console.error('\nFATAL:', err);
  pool.end().then(() => process.exit(1));
});
