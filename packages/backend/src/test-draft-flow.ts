/**
 * QA Draft Flow Test
 * Runs directly against backend service functions — no HTTP, no shell.
 * Usage: npx tsx src/test-draft-flow.ts
 */

import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { pool, query } from './config/database';
import {
  startDraft,
  getDraftState,
  makePick,
  getAvailablePlayers,
} from './services/draftService';

// ─── Test state ───────────────────────────────────────────────────────────────
let commishId    = '';
let aliceId      = '';
let leagueId     = '';
let commishTeamId = '';
let aliceTeamId   = '';
let inviteCode   = '';

let passed = 0;
let failed = 0;

// ─── Runner ───────────────────────────────────────────────────────────────────
async function step(name: string, fn: () => Promise<void>): Promise<boolean> {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    passed++;
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  FAIL  ${name}`);
    console.error(`        → ${msg}`);
    failed++;
    return false;
  }
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────
async function cleanup() {
  if (leagueId) {
    await query('DELETE FROM leagues WHERE id = $1', [leagueId]).catch(() => {});
  }
  await query("DELETE FROM users WHERE email LIKE '%@qa.invalid'").catch(() => {});
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n══════════════════════════════════════════');
  console.log(' No Fun League — Draft Flow QA');
  console.log('══════════════════════════════════════════\n');

  const hash = await bcrypt.hash('qapass', 8);

  // ── 1. Create users ──────────────────────────────────────────────────────────
  console.log('── Users ──');

  await step('Create commissioner user', async () => {
    const { rows: [u] } = await query(
      `INSERT INTO users (username, email, password_hash, display_name)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      ['qa_commish', 'qa_commish@qa.invalid', hash, 'QA Commissioner']
    );
    commishId = u.id;
    if (!commishId) throw new Error('No ID returned');
  });

  await step('Create team manager (Alice)', async () => {
    const { rows: [u] } = await query(
      `INSERT INTO users (username, email, password_hash, display_name)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      ['qa_alice', 'qa_alice@qa.invalid', hash, 'QA Alice']
    );
    aliceId = u.id;
    if (!aliceId) throw new Error('No ID returned');
  });

  // ── 2. League creation ───────────────────────────────────────────────────────
  console.log('\n── League ──');

  await step('Commissioner creates league (status = pre_draft)', async () => {
    const { rows: [l] } = await query(
      `INSERT INTO leagues (name, commissioner_id, season, status)
       VALUES ($1, $2, 2026, 'pre_draft')
       RETURNING id, status`,
      ['QA Draft League', commishId]
    );
    leagueId = l.id;
    if (l.status !== 'pre_draft') throw new Error(`Expected pre_draft, got ${l.status}`);
  });

  await step('Commissioner team created', async () => {
    const { rows: [t] } = await query(
      `INSERT INTO teams (league_id, user_id, name)
       VALUES ($1, $2, $3) RETURNING id`,
      [leagueId, commishId, "Commissioner's Team"]
    );
    commishTeamId = t.id;
  });

  // ── 3. Invite flow ───────────────────────────────────────────────────────────
  console.log('\n── Invite ──');

  await step('Generate invite code', async () => {
    inviteCode = randomBytes(6).toString('base64url').slice(0, 8).toUpperCase();
    await query(
      `INSERT INTO league_invites (league_id, code, created_by, is_active)
       VALUES ($1, $2, $3, TRUE)`,
      [leagueId, inviteCode, commishId]
    );
    if (!inviteCode) throw new Error('Code not set');
  });

  await step('Invite code is findable and active', async () => {
    const { rows: [inv] } = await query(
      `SELECT * FROM league_invites WHERE code = $1 AND is_active = TRUE`,
      [inviteCode]
    );
    if (!inv) throw new Error('Invite not found or inactive');
    if (inv.league_id !== leagueId) throw new Error('Invite references wrong league');
  });

  await step('Alice joins via invite (team auto-created)', async () => {
    // Verify not already a member
    const { rows: [existing] } = await query(
      `SELECT id FROM teams WHERE league_id = $1 AND user_id = $2`,
      [leagueId, aliceId]
    );
    if (existing) throw new Error('Alice is already in the league');

    // Create team (mirrors what POST /api/invites/:code/join does)
    const { rows: [t] } = await query(
      `INSERT INTO teams (league_id, user_id, name)
       VALUES ($1, $2, $3) RETURNING id`,
      [leagueId, aliceId, "Alice's Team"]
    );
    aliceTeamId = t.id;

    // Increment uses
    await query(
      `UPDATE league_invites SET uses = uses + 1 WHERE code = $1`,
      [inviteCode]
    );
  });

  await step('Invite uses incremented to 1', async () => {
    const { rows: [inv] } = await query(
      `SELECT uses FROM league_invites WHERE code = $1`,
      [inviteCode]
    );
    if (inv.uses !== 1) throw new Error(`Expected uses=1, got ${inv.uses}`);
  });

  await step('League now has exactly 2 teams', async () => {
    const { rows } = await query(
      `SELECT id FROM teams WHERE league_id = $1`,
      [leagueId]
    );
    if (rows.length !== 2) throw new Error(`Expected 2, got ${rows.length}`);
  });

  // ── 4. Draft start ───────────────────────────────────────────────────────────
  console.log('\n── Draft Start ──');

  await step('Non-commissioner cannot start draft', async () => {
    try {
      await startDraft(leagueId, aliceId);
      throw new Error('Should have been rejected');
    } catch (err) {
      const msg = (err as Error).message;
      if (!msg.toLowerCase().includes('commissioner')) {
        throw new Error(`Wrong error: "${msg}"`);
      }
    }
  });

  let sessionId = '';
  await step('Commissioner starts draft (rounds from settings)', async () => {
    const result = await startDraft(leagueId, commishId);
    sessionId = result.session_id;
    if (!sessionId) throw new Error('No session_id returned');
  });

  await step('League status changed to drafting', async () => {
    const { rows: [l] } = await query(
      `SELECT status FROM leagues WHERE id = $1`,
      [leagueId]
    );
    if (l.status !== 'drafting') throw new Error(`Expected drafting, got ${l.status}`);
  });

  // ── 5. Draft state ───────────────────────────────────────────────────────────
  console.log('\n── Draft State ──');

  let firstOnClockTeamId = '';

  await step('Draft state: active, pick 1, 2 teams', async () => {
    const state = await getDraftState(leagueId);
    const sess = state.session as Record<string, unknown>;
    if (sess['status'] !== 'active') throw new Error(`Expected active, got ${sess['status']}`);
    if (Number(sess['current_pick']) !== 1) throw new Error(`Expected pick 1, got ${sess['current_pick']}`);
    if (state.teams.length !== 2) throw new Error(`Expected 2 teams, got ${state.teams.length}`);
    firstOnClockTeamId = state.currentTeamId ?? '';
    if (!firstOnClockTeamId) throw new Error('currentTeamId is null');
  });

  await step('Available players returns results', async () => {
    const players = await getAvailablePlayers(leagueId, { limit: 10 });
    if (players.length === 0) throw new Error('No players available — seed data may be missing');
  });

  // ── 6. Turn enforcement ──────────────────────────────────────────────────────
  console.log('\n── Turn Enforcement ──');

  await step('Wrong user is blocked from picking (403)', async () => {
    // Figure out who is NOT on the clock
    const wrongUserId = firstOnClockTeamId === commishTeamId ? aliceId : commishId;
    const players = await getAvailablePlayers(leagueId, { limit: 1 });
    if (!players.length) throw new Error('No players to attempt pick with');

    try {
      await makePick(leagueId, wrongUserId, players[0].id as string);
      throw new Error('Pick should have been rejected — not that users turn');
    } catch (err) {
      const msg = (err as Error).message;
      if (!msg.toLowerCase().includes('not your turn')) {
        throw new Error(`Expected "not your turn" error, got: "${msg}"`);
      }
    }
  });

  await step('Duplicate player pick rejected (409)', async () => {
    // First pick by the correct user, then try the same player again
    const state = await getDraftState(leagueId);
    const onClockTeamId = state.currentTeamId!;
    const userId = onClockTeamId === commishTeamId ? commishId : aliceId;
    const players = await getAvailablePlayers(leagueId, { limit: 1 });
    const targetPlayerId = players[0].id as string;

    // Make the pick legitimately
    await makePick(leagueId, userId, targetPlayerId);

    // Try the same player again (different user, their turn now)
    const state2 = await getDraftState(leagueId);
    const nextTeamId = state2.currentTeamId!;
    const nextUserId = nextTeamId === commishTeamId ? commishId : aliceId;

    try {
      await makePick(leagueId, nextUserId, targetPlayerId);
      throw new Error('Duplicate pick should have been rejected');
    } catch (err) {
      const msg = (err as Error).message;
      if (!msg.toLowerCase().includes('already drafted')) {
        throw new Error(`Expected "already drafted" error, got: "${msg}"`);
      }
    }
  });

  // ── 7. Complete draft ────────────────────────────────────────────────────────
  console.log('\n── Complete Draft ──');

  await step('Complete all remaining picks until draft is done', async () => {
    // Loop until session is complete or safety limit hit (avoid infinite loop)
    for (let attempt = 0; attempt < 20; attempt++) {
      const state = await getDraftState(leagueId);
      const sess = state.session as Record<string, unknown>;
      if (sess['status'] === 'complete') break;

      const onClockTeamId = state.currentTeamId!;
      const userId = onClockTeamId === commishTeamId ? commishId : aliceId;

      const players = await getAvailablePlayers(leagueId, { limit: 1 });
      if (!players.length) throw new Error(`No players available at attempt ${attempt + 1}`);

      await makePick(leagueId, userId, players[0].id as string);
    }

    // Confirm it actually finished
    const finalState = await getDraftState(leagueId);
    const sess = finalState.session as Record<string, unknown>;
    if (sess['status'] !== 'complete') {
      throw new Error(`Draft still not complete after loop — status: ${sess['status']}, pick: ${sess['current_pick']}`);
    }
  });

  // ── 8. Post-draft verification ────────────────────────────────────────────────
  console.log('\n── Post-Draft Verification ──');

  await step('Draft session status = complete', async () => {
    const state = await getDraftState(leagueId);
    const sess = state.session as Record<string, unknown>;
    if (sess['status'] !== 'complete') throw new Error(`Expected complete, got ${sess['status']}`);
  });

  await step('League status = in_season', async () => {
    const { rows: [l] } = await query(
      `SELECT status FROM leagues WHERE id = $1`,
      [leagueId]
    );
    if (l.status !== 'in_season') throw new Error(`Expected in_season, got ${l.status}`);
  });

  await step('Each team has exactly 5 roster players', async () => {
    for (const [label, teamId] of [['Commissioner', commishTeamId], ['Alice', aliceTeamId]]) {
      const { rows } = await query(
        `SELECT player_id FROM rosters WHERE team_id = $1`,
        [teamId]
      );
      if (rows.length !== 5) {
        throw new Error(`${label}: expected 5 players, got ${rows.length}`);
      }
    }
  });

  await step('All 10 draft picks recorded', async () => {
    const { rows: [{ count }] } = await query(
      `SELECT COUNT(*) FROM draft_picks WHERE league_id = $1`,
      [leagueId]
    );
    if (Number(count) !== 10) throw new Error(`Expected 10 picks, got ${count}`);
  });

  await step('No player drafted by two different teams', async () => {
    const { rows } = await query(
      `SELECT player_id, COUNT(DISTINCT team_id) AS team_count
       FROM draft_picks WHERE league_id = $1
       GROUP BY player_id
       HAVING COUNT(DISTINCT team_id) > 1`,
      [leagueId]
    );
    if (rows.length > 0) {
      throw new Error(`${rows.length} player(s) on multiple teams: ${rows.map((r: Record<string, unknown>) => r['player_id']).join(', ')}`);
    }
  });

  await step('Snake order: picks 3 and 4 match expected reversal', async () => {
    const { rows: picks } = await query(
      `SELECT team_id, overall_pick FROM draft_picks
       WHERE league_id = $1 ORDER BY overall_pick`,
      [leagueId]
    );
    // 2-team snake: A B | B A | A B | B A | A B
    // P1=A, P2=B, P3=B (round 2 reverses), P4=A
    const p2Team = picks[1].team_id;
    const p3Team = picks[2].team_id;
    const p1Team = picks[0].team_id;
    const p4Team = picks[3].team_id;
    if (p3Team !== p2Team) throw new Error(`Pick 3 should match pick 2 (${p2Team}), got ${p3Team}`);
    if (p4Team !== p1Team) throw new Error(`Pick 4 should match pick 1 (${p1Team}), got ${p4Team}`);
  });

  await step('Roster acquisition_type = draft for all players', async () => {
    const { rows } = await query(
      `SELECT player_id, acquisition_type FROM rosters
       WHERE team_id IN ($1, $2) AND acquisition_type != 'draft'`,
      [commishTeamId, aliceTeamId]
    );
    if (rows.length > 0) {
      throw new Error(`${rows.length} player(s) with wrong acquisition_type`);
    }
  });

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════');
  console.log(` Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════\n');

  await cleanup();
  pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error('Fatal:', err);
  await cleanup();
  pool.end();
  process.exit(1);
});
