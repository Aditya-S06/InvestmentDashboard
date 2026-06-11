/**
 * Copy this file to config.ts and set your models, tools, and limits.
 * config.ts is gitignored and never committed.
 */
import 'server-only';

export const INSIGHTS_MODELS = ['your-vendor/primary-model', 'your-vendor/fallback-model'] as const;

export const INSIGHTS_MAX_TOOL_ITERATIONS = 8;
export const INSIGHTS_RATE_LIMIT_PER_HOUR = 10;

export const INSIGHTS_WEB_SEARCH_TOOL = {
  type: 'openrouter:web_search',
  parameters: {
    engine: 'exa',
    maxResults: 5,
    maxTotalResults: 20,
    allowedDomains: ['example.com'],
  },
} as const;

export const INSIGHTS_WEB_FETCH_TOOL = {
  type: 'openrouter:web_fetch',
} as const;

export function getAdminEmails() {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}
