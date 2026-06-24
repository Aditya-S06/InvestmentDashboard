/**
 * Copy to tools.ts and wire app + OpenRouter tools.
 * tools.ts is gitignored and never committed.
 */
import 'server-only';

import { z } from 'zod';
import { runPython } from '@/lib/python-runner';
import { INSIGHTS_WEB_FETCH_TOOL, INSIGHTS_WEB_SEARCH_TOOL } from './config';
import type { AppToolResult, InsightFinalOutput, InsightToolExecutionContext } from './types';

const tickerArgsSchema = z.object({
  symbol: z.string().min(1).max(12),
});

const finalOutputSchema = z.object({
  summary: z.string().min(1),
  picks: z
    .array(
      z.object({
        symbol: z.string().min(1).max(12),
        thesis: z.string().min(1),
        confidence: z.enum(['high', 'medium', 'low']),
        signals: z.array(z.string().min(1)).min(1),
        inWatchlist: z.boolean(),
        sources: z.array(z.string().url()).optional(),
      }),
    )
    .min(1)
    .max(10),
});

export const INSIGHTS_APP_TOOLS = [
  // TODO: define get_user_watchlist, get_ticker_fundamentals, get_macro_snapshot, submit_stock_insights
] as const;

export const INSIGHTS_TOOLS = [INSIGHTS_WEB_SEARCH_TOOL, INSIGHTS_WEB_FETCH_TOOL, ...INSIGHTS_APP_TOOLS] as const;

export async function executeInsightTool(
  name: string,
  rawArgs: string,
  executionContext: InsightToolExecutionContext,
): Promise<AppToolResult> {
  void name;
  void rawArgs;
  void executionContext;
  return { ok: false, error: 'Configure tools.ts to enable AI Insights tools.' };
}

function normalizeFinalOutput(output: z.infer<typeof finalOutputSchema>): InsightFinalOutput {
  return {
    summary: output.summary,
    picks: output.picks.map((pick) => ({
      ...pick,
      symbol: pick.symbol.trim().toUpperCase(),
      sources: pick.sources?.filter(Boolean),
    })),
  };
}
