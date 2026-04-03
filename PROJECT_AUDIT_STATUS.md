# No Fun League — Project Status Report
_Audited: 2026-03-26_

---

## 1. CURRENT STATE

### What Already Works
- **Auth** — Register, login, logout, JWT tokens, bcrypt passwords, rate limiting. Fully functional.
- **League creation** — Create a native league or link a Sleeper league ID. Commissioner role assigned correctly.
- **Invite system** — Generate invite codes, share links, join via code. Transaction-locked to prevent race conditions.
- **Team creation** — Create a team manually or import from Sleeper via sync.
- **Player database** — Full NFL player sync from Sleeper (QB/RB/WR/TE/K/DEF), searchable, injury status included.
- **Draft system** — Full snake draft: start, make picks, timer, turn order, roster assignment on pick. Transaction-safe.
- **Roster management** — View starters/bench, edit lineup, lineup lock enforced (no changes after a player's game starts).
- **Sleeper sync** — Import teams, rosters, W-L records, scoring format, and current week from Sleeper.
- **Matchup import** — Import Sleeper matchup scores into the local DB for a given week.
- **Scoring math** — `calculateFantasyPoints()` correctly handles PPR, half-PPR, and standard scoring from raw stat fields.
- **Stats pipeline** — Weekly player stats synced from Sleeper, stored in `player_stats` table with all three scoring formats pre-computed.
- **Scheduler** — Cron jobs registered for nightly player sync (2am UTC), Tuesday stats sync (4am), Tuesday roster sync (6am), Wednesday schedule sync (8am).
- **Standings display** — League page shows W-L, points for/against, sorted by record.
- **Matchups page** — Displays imported matchups with scores and winner highlighting.
- **AI features** — Trash talk, weekly recap, lineup advice, waiver recommendations (all require `ANTHROPIC_API_KEY`).

### What Partially Works
- **Standings updates** — Display is correct but W-L is only updated via Sleeper sync, NOT when matchups are imported. These are two disconnected operations.
- **Native (non-Sleeper) leagues** — League creation works but matchup generation and score calculation do not exist. A native league cannot be played.
- **Scoring pipeline** — `calculateFantasyPoints()` and `player_stats` are real and correct, but they are never called to produce a team's weekly total. Team scores come from Sleeper's pre-calculated values on import.

### What Is Broken
- **Standings after matchup import** — `import-matchups` correctly writes `winner_team_id` to the `matchups` table but never increments `teams.wins` or `teams.losses`. You must also run "Sync from Sleeper" to see updated standings. Two separate manual steps are required, and order matters.
- **Trade system** — Backend only has GET endpoints (view history, inbox, approvals). There are no routes to propose, accept, or reject a trade. Frontend references `trades.propose`, `trades.respond`, `trades.approve` — none of these exist on the backend. Trades are completely read-only.
- **Native matchup schedule** — No round-robin schedule generator exists. Non-Sleeper leagues have no way to produce weekly matchup pairings.
- **Native score calculation** — No endpoint exists to compute a team's weekly score from their starters' `player_stats`. The scoring engine is real but wired to nothing for native leagues.

---

## 2. CORE GAME LOOP STATUS

| Feature | Status | Notes |
|---------|--------|-------|
| Auth / login | **Working** | Complete — register, login, JWT, protected routes |
| League creation | **Working** | Complete — native or Sleeper-linked |
| Teams / rosters | **Working** | Complete — creation, import, starters, bench, lineup lock |
| Draft | **Working** | Complete — snake draft, timer, transaction-safe picks |
| Matchups | **Partial** | Sleeper import works. No native schedule generator. |
| Standings | **Partial** | Display is correct. W-L not updated by matchup import — requires separate Sleeper sync. |
| Scoring | **Partial** | Math is correct. Stats exist. But team scores never computed natively from rosters. |
| Sleeper sync | **Working** | Complete — players, rosters, W-L, stats, schedule all sync correctly |
| Native (non-Sleeper) league flow | **Missing** | No matchup generation. No score calculation. Cannot run a game without Sleeper. |
| Navigation / UI pages | **Working** | Dashboard, league, roster, draft, matchups, chat pages all exist and render real data |

---

## 3. TOP 5 BLOCKERS

**Blocker 1 — `import-matchups` does not update W-L**
After importing a week's scores, `matchups.winner_team_id` is set but `teams.wins` and `teams.losses` are never touched. Standings only update if you also run "Sync from Sleeper." This is the most immediately visible bug — standings lie after every matchup import.

**Blocker 2 — No native matchup schedule generator**
There is no `generate-schedule` endpoint. For any league not linked to Sleeper, week-by-week matchup pairings cannot be created. The entire game loop is blocked for native leagues.

**Blocker 3 — No native score calculation from rosters**
`calculateFantasyPoints()` exists and is correct. `player_stats` is populated. But there is no endpoint that reads a team's starters for a given week, sums their stats, and writes a team score. The two halves of the scoring system are not connected.

**Blocker 4 — Trade system is completely non-functional**
Only GET endpoints exist on the backend. No one can propose, accept, or veto a trade. The frontend API client calls routes that do not exist. The entire trades feature will 404 on any write action.

**Blocker 5 — No automated end-of-week pipeline**
Every week requires a commissioner to manually run two separate operations in the right order: "Import Scores" and "Sync from Sleeper." There is no "close the week" action that chains these. If done out of order, standings show incorrect data.

---

## 4. TODAY'S BEST NEXT TASK

**Fix `import-matchups` to update `teams.wins` and `teams.losses`.**

**Why this is the best next move:**
This is a 20-line fix in a single file. It closes the most visible gap — after a commissioner imports a week's results, the standings should immediately reflect the correct record. Right now they do not. Every other Sleeper-linked feature already works correctly: scores display, winner is stored, matchup history shows correctly. The only thing broken is the W-L tally. Fixing this makes the Sleeper league loop fully playable end-to-end without any other changes. No new infrastructure, no new pages, no new tables — just add three UPDATE statements inside an existing loop.

---

## 5. EXACT FILES TO TOUCH

```
packages/backend/src/routes/leagues.ts
  → POST /:id/import-matchups/:week (around line 284–385)
  → After writing winner_team_id, add:
      UPDATE teams SET wins = wins + 1 WHERE id = <winner_id>
      UPDATE teams SET losses = losses + 1 WHERE id = <loser_id>
      UPDATE teams SET points_for = points_for + <score>, points_against = points_against + <opp_score> (for both teams)
```

No other files need to change for this fix.

---

## 6. EXACT COMMANDS TO RUN

```bash
# 1. Start the backend in dev mode (from project root)
cd /Users/davidshinavar/NoFunLeague
npm run dev --workspace=packages/backend

# 2. Start the frontend in dev mode (separate terminal)
npm run dev --workspace=packages/frontend

# 3. After making the fix to leagues.ts, test it manually:
# - Log in as commissioner
# - Navigate to a Sleeper-linked league
# - Click "Import Scores" for any completed week
# - Verify standings W-L updates immediately WITHOUT needing to click "Sync from Sleeper"

# 4. Optional: trigger a manual Sleeper sync to verify no regression
curl -X POST http://localhost:3001/api/admin/sync \
  -H "Content-Type: application/json" \
  -H "X-Admin-Secret: <your ADMIN_SECRET env value>" \
  -d '{"job": "stats", "week": 1}'
```

---

## WHAT COMES NEXT (AFTER TODAY'S FIX)

Once the standings bug is fixed, these two tasks complete the native league path:

1. **Add `POST /api/leagues/:id/generate-schedule`** — round-robin matchup generator, ~50 lines
2. **Add `POST /api/leagues/:id/score-week/:week`** — reads starters → sums `player_stats` → writes scores + updates W-L, ~50 lines

Those two endpoints make native leagues fully playable and close the core game loop completely.
