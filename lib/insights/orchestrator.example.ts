/**
 * Copy this file to orchestrator.ts and implement the agent / tool loop.
 * orchestrator.ts is gitignored and never committed.
 */
import 'server-only';

import type { InsightChatMetadata, InsightCitation, InsightFinalOutput } from './types';

type ChatRole = 'user' | 'assistant';

export interface InsightInputMessage {
  role: ChatRole;
  content: string;
  metadata?: InsightChatMetadata | null;
}

export type InsightStreamEvent =
  | { type: 'status'; message: string }
  | { type: 'tool_call'; name: string; args: Record<string, unknown> }
  | { type: 'delta'; text: string }
  | { type: 'picks'; picks: InsightFinalOutput['picks']; summary: string }
  | { type: 'citations'; citations: InsightCitation[] };

export interface RunInsightChatInput {
  apiKey: string;
  userId: string;
  messages: InsightInputMessage[];
  sessionId?: string;
  onEvent?: (event: InsightStreamEvent) => void | Promise<void>;
}

export interface RunInsightChatResult {
  content: string;
  metadata: InsightChatMetadata;
}

export async function runInsightChat(input: RunInsightChatInput): Promise<RunInsightChatResult> {
  // TODO: build context, call OpenRouter with tools, stream events via onEvent
  await input.onEvent?.({ type: 'status', message: 'Configure orchestrator.ts to enable AI Insights.' });

  return {
    content: 'AI Insights orchestrator is not configured. Copy orchestrator.example.ts to orchestrator.ts.',
    metadata: {},
  };
}
