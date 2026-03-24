import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 1024;

// =============================================
// Context Types
// =============================================
export interface TrashTalkContext {
  targetTeamName: string;
  targetOwnerName: string;
  targetScore: number;
  opponentTeamName: string;
  opponentScore: number;
  week: number;
  targetTopScorer?: string;
  targetBiggestBust?: string;
  style?: string; // aggressive | petty | poetic | silent
}

export interface WeeklyRecapContext {
  week: number;
  leagueName: string;
  matchups: Array<{
    winnerTeam: string;
    winnerScore: number;
    loserTeam: string;
    loserScore: number;
  }>;
  highestScore: { team: string; score: number };
  lowestScore: { team: string; score: number };
  leagueAvgScore: number;
}

export interface DraftCommentaryContext {
  pick: number;
  round: number;
  playerName: string;
  playerPosition: string;
  playerTeam: string;
  pickedByTeam: string;
  previousPickContext?: string;
}

export interface TradeReactionContext {
  team1Name: string;
  team1Giving: string[];
  team2Name: string;
  team2Giving: string[];
  leagueContext?: string;
}

// =============================================
// System Prompt
// =============================================
const NFL_TRASH_TALK_SYSTEM = `You are CHAOS, the AI commissioner of The No Fun League — an AI-powered fantasy football platform where trash talk, chaos, and domination are fully automated.

Your personality:
- Ruthlessly funny, sharp-tongued, and savage — but never hateful or personal
- You know football deeply and use stats to roast people
- You love chaos and unpredictability
- You call out bad decisions, bad luck, and bad teams equally
- Keep it short, punchy, and social-media ready (1-4 sentences max for trash talk)
- For recaps, be more detailed but still entertaining

Never be: racist, sexist, homophobic, or personally attacking real people beyond fantasy football performance.
Always stay in: fantasy football context.`;

// =============================================
// Trash Talk
// =============================================
export async function generateTrashTalk(ctx: TrashTalkContext): Promise<string> {
  const styleGuide = {
    aggressive: 'Be brutal, savage, no mercy. Hit them where it hurts (their fantasy lineup).',
    petty: 'Be passive-aggressive and petty. Backhanded compliments. Dripping with condescension.',
    poetic: 'Be poetic and dramatic. Use metaphors. Make losing sound like Greek tragedy.',
    silent: 'Keep it extremely brief and cold. One sentence. Make them feel ignored.',
  }[ctx.style || 'aggressive'];

  const prompt = `Generate trash talk for Week ${ctx.week}.

Target: ${ctx.targetOwnerName}'s team "${ctx.targetTeamName}" — scored ${ctx.targetScore} points.
${ctx.targetTopScorer ? `Their best player: ${ctx.targetTopScorer}` : ''}
${ctx.targetBiggestBust ? `Their biggest bust: ${ctx.targetBiggestBust}` : ''}
Opponent: "${ctx.opponentTeamName}" — scored ${ctx.opponentScore} points.
Result: ${ctx.targetScore > ctx.opponentScore ? `${ctx.targetTeamName} WON` : `${ctx.targetTeamName} LOST`}

Style: ${styleGuide}

Generate 1-3 sentences of brutal fantasy football trash talk directed at ${ctx.targetOwnerName}.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: NFL_TRASH_TALK_SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  });

  return (response.content[0] as { text: string }).text;
}

// =============================================
// Weekly Recap
// =============================================
export async function generateWeeklyRecap(ctx: WeeklyRecapContext): Promise<string> {
  const matchupLines = ctx.matchups
    .map(m => `- ${m.winnerTeam} (${m.winnerScore}) beat ${m.loserTeam} (${m.loserScore})`)
    .join('\n');

  const prompt = `Write the Week ${ctx.week} recap for "${ctx.leagueName}".

RESULTS:
${matchupLines}

High score: ${ctx.highestScore.team} with ${ctx.highestScore.score} points
Low score: ${ctx.lowestScore.team} with ${ctx.lowestScore.score} points
League average: ${ctx.leagueAvgScore.toFixed(1)} points

Write an entertaining 3-5 paragraph weekly recap in the style of a sports columnist who has zero chill.
Celebrate winners, roast losers, call out lucky wins and unlucky losses. Be dramatic. Be savage. Be funny.
End with a spicy prediction or warning for next week.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: NFL_TRASH_TALK_SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  });

  return (response.content[0] as { text: string }).text;
}

// =============================================
// Draft Commentary
// =============================================
export async function generateDraftCommentary(ctx: DraftCommentaryContext): Promise<string> {
  const prompt = `Draft commentary — Round ${ctx.round}, Pick ${ctx.pick}:
${ctx.pickedByTeam} just drafted ${ctx.playerName} (${ctx.playerPosition}, ${ctx.playerTeam}).
${ctx.previousPickContext ? `Context: ${ctx.previousPickContext}` : ''}

Write 1-2 sentences of live draft commentary. Be opinionated — was this a steal, a reach, or a disaster?`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 256,
    system: NFL_TRASH_TALK_SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  });

  return (response.content[0] as { text: string }).text;
}

// =============================================
// Trade Reaction
// =============================================
export async function generateTradeReaction(ctx: TradeReactionContext): Promise<string> {
  const prompt = `React to this trade:
${ctx.team1Name} gives: ${ctx.team1Giving.join(', ')}
${ctx.team2Name} gives: ${ctx.team2Giving.join(', ')}
${ctx.leagueContext ? `League context: ${ctx.leagueContext}` : ''}

Who won this trade? React in 2-3 sentences. Be opinionated and savage. Call out anyone getting robbed.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    system: NFL_TRASH_TALK_SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  });

  return (response.content[0] as { text: string }).text;
}

// =============================================
// Phase 2 Hook: AI Lineup Advice (placeholder)
// =============================================
export async function generateLineupAdvice(_teamId: string, _week: number): Promise<string> {
  // Phase 2: Analyze roster and give start/sit advice with trash talk flavor
  return 'Phase 2 feature: AI lineup advice coming soon.';
}

// =============================================
// Phase 3 Hook: AI Waiver Recommendations (placeholder)
// =============================================
export async function generateWaiverRecommendations(_leagueId: string, _week: number): Promise<string> {
  // Phase 3: Analyze waiver wire and recommend pickups
  return 'Phase 3 feature: AI waiver recommendations coming soon.';
}
