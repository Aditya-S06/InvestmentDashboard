import fs from 'fs';
import path from 'path';
import { expect, it } from 'vitest';
import { DESK_POLICY } from './policy';
import { curateDeskState, deskRunResults, packDeskResults } from './report';

it('keeps published ceilings aligned with the supervisor policy', () => {
  const python = fs.readFileSync(path.join(process.cwd(), 'scripts/desk_policy.py'), 'utf8');
  for (const [depth, policy] of Object.entries(DESK_POLICY)) {
    expect(python).toContain(`'${depth}': ${policy.minutes * 60}`);
    expect(python).toContain(`'${depth}': ${policy.toolRounds}`);
  }
});

it('retains failed-run accounting but excludes unknown provider data', () => {
  const finalState = { run_settings: { quick_think_llm: 'deepseek/deepseek-v4.1-flash', max_tool_rounds: 5, api_key: 'fixture' },
    desk_usage: { budget_usd: 1, spent_usd: .03, reserved_usd: .02,
      headers: 'fixture', attempts: [{ tier: 'quick', node: 'Market Analyst', status: 'pending',
        cost_usd: null, input_tokens: Infinity, prompt: 'fixture' }], tools: [] } };
  const packed = packDeskResults([{ ticker: 'NVDA', status: 'failed', signal: null, finalState,
    error: 'timeout', startedAt: null, finishedAt: null }]);
  const result = deskRunResults({ tickers: ['NVDA'], status: 'failed', signal: null,
    finalState: packed, asOf: '2026-10-01' })[0];
  expect(result.finalState?.desk_usage).toMatchObject({ spent_usd: .03, reserved_usd: .02 });
  expect(JSON.stringify(result.finalState)).not.toContain('fixture');
  expect(curateDeskState(finalState)?.run_settings).toMatchObject({ max_tool_rounds: 5 });
});
