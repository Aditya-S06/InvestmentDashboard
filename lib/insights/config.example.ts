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

/** Enough for ~5 tickers with parallel fundamentals + a few searches + submit. */
export const INSIGHTS_MAX_TOOL_ITERATIONS = 14;
export const INSIGHTS_RATE_LIMIT_PER_HOUR = 12;
export const INSIGHTS_MAX_IMAGES_PER_MESSAGE = 4;
export const INSIGHTS_MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export const INSIGHTS_WEB_SEARCH_TOOL = {
  type: 'openrouter:web_search',
  parameters: {
    // auto: native search when the provider supports it (e.g. Grok/xAI), else Exa.
    // No domain allowlist — filters often force Exa fallbacks and trigger "Server tool request failed".
    engine: 'auto',
    maxResults: 5,
    maxTotalResults: 20,
  },
} as const;

/** Kept for optional use; not included in default INSIGHTS_TOOLS (fetch failures abort the whole turn). */
export const INSIGHTS_WEB_FETCH_TOOL = {
  type: 'openrouter:web_fetch',
  parameters: {
    engine: 'auto',
    maxUses: 2,
  },
} as const;

export function getAdminEmails() {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}
