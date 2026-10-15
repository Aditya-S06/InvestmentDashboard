import { curateDeskState, curateDeskUsage } from '@/lib/desk/report';

export function DeskUsage({ state }: { state: unknown }) {
  const clean = curateDeskState(state);
  const usage = curateDeskUsage(clean?.desk_usage);
  const settings = clean?.run_settings as Record<string, unknown> | undefined;
  if (!usage) return null;
  const attempts = usage.attempts as Record<string, unknown>[];
  const tools = usage.tools as Record<string, unknown>[];
  const spent = typeof usage.spent_usd === 'number' ? usage.spent_usd : 0;
  const reserved = typeof usage.reserved_usd === 'number' ? usage.reserved_usd : 0;
  return <details className="border-b border-border px-4 py-3 text-xs text-muted-foreground">
    <summary className="cursor-pointer">Usage: ${spent.toFixed(4)} reported · {attempts.length} model attempts
      {reserved > 0 ? ` · $${reserved.toFixed(4)} pending/unknown` : ''}</summary>
    <div className="mt-2 space-y-2">
      <p>Quick: {String(settings?.quick_think_llm ?? 'unknown')} · Deep: {String(settings?.deep_think_llm ?? 'unknown')}</p>
      <p>Admission budget: ${String(usage.budget_usd ?? 'unknown')} per ticker. Pending/unknown reservations are not confirmed charges.</p>
      {typeof usage.stop_reason === 'string' && <p>{usage.stop_reason}</p>}
      <ul className="max-h-48 space-y-1 overflow-auto">
        {attempts.map((row, i) => <li key={`llm-${i}`}>{String(row.node)} · {String(row.tier)} · {String(row.status)} · {Math.round(Number(row.elapsed_ms) / 1000)}s · {Number(row.input_tokens)} in / {Number(row.output_tokens)} out</li>)}
        {tools.map((row, i) => <li key={`tool-${i}`}>{String(row.name)} · {String(row.status)} · {Math.round(Number(row.elapsed_ms) / 1000)}s{row.cached ? ' · reused' : ''}</li>)}
      </ul>
    </div>
  </details>;
}
