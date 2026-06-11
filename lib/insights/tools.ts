import 'server-only';

import { z } from 'zod';
import { runPython } from '@/lib/python-runner';
import { INSIGHTS_WEB_FETCH_TOOL, INSIGHTS_WEB_SEARCH_TOOL } from './config';
import type { AppToolResult, InsightFinalOutput, InsightToolExecutionContext } from './types';

const tickerArgsSchema = z.object({
  symbol: z.string().min(1).max(12),
});

const insightPickSchema = z.object({
  symbol: z.string().min(1).max(12),
  thesis: z.string().min(1),
  confidence: z.enum(['high', 'medium', 'low']),
  signals: z.array(z.string().min(1)).min(1),
  inWatchlist: z.boolean(),
  sources: z.array(z.string().url()).optional(),
});

const finalOutputSchema = z.object({
  summary: z.string().min(1),
  picks: z.array(insightPickSchema).min(1).max(10),
});

export const INSIGHTS_APP_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_user_watchlist',
      description: 'Return the logged-in user watchlist grouped by sector. Use this before analyzing user-owned tickers.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_ticker_fundamentals',
      description:
        'Fetch app-native market data for a ticker: price, fundamentals, analyst data, sentiment, risk, technicals, news, and trends.',
      parameters: {
        type: 'object',
        properties: {
          symbol: {
            type: 'string',
            description: 'Ticker symbol, for example NVDA or RKLB.',
          },
        },
        required: ['symbol'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_macro_snapshot',
      description: 'Return current macro dashboard data such as VIX, S&P 500, Treasury yield, Fed Funds, and market status.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'submit_stock_insights',
      description:
        'Submit the final 5-10 stock insight picks in structured form after research is complete. Use cautious signal language, not guarantees.',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          picks: {
            type: 'array',
            minItems: 1,
            maxItems: 10,
            items: {
              type: 'object',
              properties: {
                symbol: { type: 'string' },
                thesis: { type: 'string' },
                confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                signals: { type: 'array', items: { type: 'string' }, minItems: 1 },
                inWatchlist: { type: 'boolean' },
                sources: { type: 'array', items: { type: 'string' } },
              },
              required: ['symbol', 'thesis', 'confidence', 'signals', 'inWatchlist'],
              additionalProperties: false,
            },
          },
        },
        required: ['summary', 'picks'],
        additionalProperties: false,
      },
    },
  },
] as const;

export const INSIGHTS_TOOLS = [
  INSIGHTS_WEB_SEARCH_TOOL,
  INSIGHTS_WEB_FETCH_TOOL,
  ...INSIGHTS_APP_TOOLS,
] as const;

export async function executeInsightTool(
  name: string,
  rawArgs: string,
  executionContext: InsightToolExecutionContext,
): Promise<AppToolResult> {
  try {
    const args = parseToolArgs(rawArgs);

    if (name === 'get_user_watchlist') {
      return {
        ok: true,
        data: {
          count: executionContext.context.watchlist.length,
          groupedWatchlist: executionContext.context.groupedWatchlist,
          watchlistSnapshot: executionContext.context.watchlistSnapshot,
        },
      };
    }

    if (name === 'get_ticker_fundamentals') {
      const parsed = tickerArgsSchema.parse(args);
      const symbol = parsed.symbol.trim().toUpperCase();
      const data = await runPython(['full', symbol]);
      return { ok: !data?.error, data, error: data?.error };
    }

    if (name === 'get_macro_snapshot') {
      const macro = executionContext.context.macro ?? (await runPython(['macro']));
      return { ok: true, data: macro };
    }

    if (name === 'submit_stock_insights') {
      const output = normalizeFinalOutput(finalOutputSchema.parse(args));
      executionContext.finalOutput = output;
      return { ok: true, data: { accepted: true, pickCount: output.picks.length } };
    }

    return { ok: false, error: `Unknown tool: ${name}` };
  } catch (error: any) {
    return { ok: false, error: error?.message ?? 'Tool execution failed' };
  }
}

function parseToolArgs(rawArgs: string): Record<string, unknown> {
  if (!rawArgs) return {};
  const parsed = JSON.parse(rawArgs);
  return parsed && typeof parsed === 'object' ? parsed : {};
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

