/**
 * Copy this file to config.ts and set your models, tools, and limits.
 * config.ts is gitignored and never committed.
 *
 * Prefer editing lib/insights/models.ts for the selectable OpenRouter model catalog.
 */
import 'server-only';

import { DEFAULT_INSIGHTS_MODEL_ID, INSIGHTS_MODEL_OPTIONS } from './models';

export const INSIGHTS_MODELS = INSIGHTS_MODEL_OPTIONS.map((option) => option.id);

export { DEFAULT_INSIGHTS_MODEL_ID, INSIGHTS_MODEL_OPTIONS };

export const INSIGHTS_MAX_TOOL_ITERATIONS = 8;
export const INSIGHTS_RATE_LIMIT_PER_HOUR = 10;
export const INSIGHTS_MAX_IMAGES_PER_MESSAGE = 4;
export const INSIGHTS_MAX_IMAGE_BYTES = 4 * 1024 * 1024;

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
