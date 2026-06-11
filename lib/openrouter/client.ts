import 'server-only';

import { OpenRouter } from '@openrouter/sdk';

export function createOpenRouterClient(apiKey: string) {
  return new OpenRouter({ apiKey });
}

