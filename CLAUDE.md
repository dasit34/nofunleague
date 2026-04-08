k# CLAUDE.md

## Project Overview
This project is a production fantasy football platform called **NoFunLeague**.

The goal is to build a fully functional league system similar to ESPN/Sleeper, with deeper customization and engagement features layered AFTER the core system is complete.

This is NOT a prototype. This is a real system.

---

## Current Build Phase (CRITICAL)

We are focused ONLY on CORE SYSTEMS:

1. Authentication (working)
2. League Creation (working)
3. Draft System (working - snake draft)
4. Rosters (working)
5. Matchups (working)
6. Standings (working)
7. Week Progression (working)

### CURRENT PRIORITY:
→ Build **League Settings + Rules System**

This system must:
- Control roster rules
- Control scoring rules
- Control draft behavior
- Control season structure

DO NOT build engagement features yet (recaps, trash talk, etc.)

---

## Non-Negotiable Product Rules

- No placeholder systems
- No fake or hardcoded logic
- All features must connect to real data + logic
- Settings must actually control system behavior (not just UI)
- Do not mark anything “done” unless it works end-to-end

---

## Tech Stack

- Next.js
- TypeScript
- Supabase (DB + Auth)
- Tailwind

---

## Architecture Rules

- Settings must be the **single source of truth**
- Scoring engine must read from settings
- Roster validation must read from settings
- Draft logic must read from settings

No duplicated logic across systems.

---

## League Settings Requirements

We are replicating a **real fantasy platform level of control**.

Settings must include:

### Roster Settings
- QB / RB / WR / TE / FLEX / K / DEF
- Bench size
- IR slots (optional later)

### Scoring Settings
- Passing (yards, TD, INT)
- Rushing (yards, TD)
- Receiving (yards, TD, PPR)
- Defense scoring
- Kicking scoring

### Draft Settings
- Draft type (snake)
- Pick timer
- Draft order

### Season Settings
- Number of weeks
- Playoff teams
- Playoff structure

These must NOT be static — they must drive system behavior.

---

## Workflow Rules (VERY IMPORTANT)

Before writing code, ALWAYS:

1. Audit existing files related to the feature
2. Explain:
   - what currently exists
   - what is missing
3. List:
   - files to be created
   - files to be modified
4. Identify risks

THEN begin coding.

---

## Implementation Rules

- Build ONE module at a time
- Fully complete it before moving on
- Do NOT partially implement features
- Do NOT skip validation logic
- Do NOT create UI without backend support

---

## Code Standards

- Use strict TypeScript
- Reuse types where possible
- No duplicate schemas
- Keep logic modular and reusable
- Avoid large, unstructured files

---

## Database Rules (Supabase)

- Always check existing schema before adding new tables
- Do not duplicate data structures
- League settings must be structured to support:
  - scoring engine
  - roster validation
  - draft logic

---

## Testing Rules

After any major change:

1. Verify no TypeScript errors
2. Verify no runtime errors
3. Manually test:
   - league creation
   - draft flow
   - roster behavior
   - standings update

If something is NOT tested, explicitly say so.

---

## Commands

- install: npm install
- dev: npm run dev
- build: npm run build
- lint: npm run lint

---

## Required Response Format (MANDATORY)

Before coding, respond with:

1. Current system state (based on file audit)
2. Plan of attack
3. Files to change
4. Files to create
5. Risks / assumptions

Only then begin implementation.

---

## Forbidden Behaviors

- No placeholder logic
- No fake “completed” features
- No unnecessary refactors
- No breaking existing working systems
- No silent schema changes
- No building UI without real logic
- No repeated confirmation loops during clearly defined tasks

---

## Definition of Done

A feature is ONLY complete when:

- It is wired to real data
- It affects real system behavior
- It is testable in the UI
- It does not break existing systems

---

## Guiding Principle

This is a **real product build**, not a demo.

Correctness > speed.
System integrity > shortcuts.
cat CLAUDE.md

