/**
 * Validates required environment variables at startup.
 * Throws on missing required vars; warns on missing optional ones.
 */
export function validateEnv(): void {
  const required = ['DATABASE_URL', 'JWT_SECRET'];
  const missing = required.filter((k) => !process.env[k]);

  if (missing.length > 0) {
    throw new Error(
      `[NFL] Missing required environment variables: ${missing.join(', ')}\n` +
      'Set these in your .env file or Railway environment settings.'
    );
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('[NFL] Warning: ANTHROPIC_API_KEY not set — AI features will be disabled at runtime');
  }
}
