/** IDs describe immutable, newline-terminated records in a scoped append-only log. */
export function parseDeskCursor(value: string): { scope: string; offset: number; digest: string } | null {
  const match = /^v1\.([a-f0-9]{64})\.([1-9][0-9]{0,15})\.([a-f0-9]{64})$/.exec(value);
  if (!match) return null;
  const offset = Number(match[2]);
  return Number.isSafeInteger(offset) ? { scope: match[1], offset, digest: match[3] } : null;
}

export function deskStreamTerminal(status: string): boolean {
  return ['completed', 'review', 'failed', 'cancelled'].includes(status);
}

export const DESK_STREAM_EVENTS = new Set([
  'desk_phase', 'desk_agent', 'desk_memo', 'desk_debate', 'desk_decision', 'desk_done', 'desk_error',
]);

export type DeskStreamEvent = { id: string; name: string; data: Record<string, unknown> };

export function deskStreamDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) { resolve(); return; }
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
  });
}
