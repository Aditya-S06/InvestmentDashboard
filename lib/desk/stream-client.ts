import { DESK_STREAM_EVENTS, deskStreamDelay, deskStreamTerminal, parseDeskCursor, type DeskStreamEvent } from './stream-protocol';

class PermanentStreamError extends Error {}

function checkResponse(response: Response) {
  if (response.ok) return;
  const message = response.status === 401 || response.status === 403 ? 'Desk access expired or is unavailable.'
    : response.status === 404 ? 'Run not found.'
      : response.status === 400 ? 'Invalid or stale stream cursor. Reload this run.' : 'Could not connect to this run.';
  if (response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status)) {
    throw new PermanentStreamError(message);
  }
  throw new Error(message);
}

/** Incomplete frames are discarded on disconnect and replayed from the last committed ID. */
export async function readDeskEventStream(
  response: Response, signal: AbortSignal, onEvent: (event: DeskStreamEvent) => void,
  onActivity: () => void = () => undefined,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Missing Desk stream');
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done || signal.aborted) break;
      onActivity();
      buffer += decoder.decode(value, { stream: true });
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const raw = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const fields = raw.split(/\r?\n/);
        const field = (name: string) => fields.filter(line => line.startsWith(`${name}:`))
          .map(line => line.slice(name.length + 1).replace(/^ /, ''));
        const name = field('event').at(-1);
        if (!name || !DESK_STREAM_EVENTS.has(name)) continue;
        const id = field('id').at(-1) ?? '';
        const data: unknown = JSON.parse(field('data').join('\n'));
        if (!parseDeskCursor(id) || !data || typeof data !== 'object' || Array.isArray(data)) {
          throw new Error('Invalid Desk stream frame');
        }
        if (!signal.aborted) onEvent({ id, name, data: data as Record<string, unknown> });
      }
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

type Run = { id: string; status: string };

/** One owner for requests, polling, replay cursor, backoff and unmount cancellation. */
export async function connectDeskStream<T extends Run>(options: {
  runId: string; signal: AbortSignal; onRun: (run: T) => void;
  onEvent: (event: DeskStreamEvent) => void; onError: (message: string) => void;
  fetch?: typeof fetch;
}): Promise<void> {
  const request = options.fetch ?? fetch;
  const base = `/api/desk/runs/${encodeURIComponent(options.runId)}`;
  let cursor: string | null = null;
  let terminal = false;
  let delay = 500;
  let loaded = false;
  const refresh = async (signal: AbortSignal) => {
    const response = await request(base, { cache: 'no-store', signal });
    checkResponse(response);
    const run = await response.json() as T;
    if (run.id !== options.runId || !['queued', 'running', 'completed', 'review', 'failed', 'cancelled'].includes(run.status)) {
      throw new Error('Invalid run response');
    }
    if (signal.aborted) return;
    // Terminal snapshots are irreversible; a concurrent earlier read cannot regress them.
    if (terminal && !deskStreamTerminal(run.status)) return;
    terminal = deskStreamTerminal(run.status);
    loaded = true;
    options.onRun(run);
  };
  while (!options.signal.aborted) {
    const connection = new AbortController();
    const abort = () => connection.abort();
    options.signal.addEventListener('abort', abort, { once: true });
    // Rotating a stalled connection also bounds an unresponsive detail request.
    let watchdog = setTimeout(abort, 30_000);
    const activity = () => { clearTimeout(watchdog); watchdog = setTimeout(abort, 30_000); };
    let poll: Promise<void> | undefined;
    let permanent: PermanentStreamError | undefined;
    let progressed = false;
    try {
      if (!loaded) await refresh(connection.signal);
      if (connection.signal.aborted) throw new Error('Connection aborted');
      const url = cursor ? `${base}/stream?after=${encodeURIComponent(cursor)}` : `${base}/stream`;
      const response = await request(url, { cache: 'no-store', signal: connection.signal });
      checkResponse(response);
      if (!response.headers.get('Content-Type')?.startsWith('text/event-stream')) throw new Error('Invalid Desk stream response');
      poll = (async () => {
        while (!connection.signal.aborted) {
          await deskStreamDelay(2000, connection.signal);
          if (connection.signal.aborted) return;
          try {
            await refresh(connection.signal);
            if (connection.signal.aborted) return;
            // Stop polling but let a progressing terminal replay drain completely.
            // The idle watchdog still releases a stalled transport; terminal forbids reconnect.
            if (terminal) return;
          } catch (error) {
            if (error instanceof PermanentStreamError) { permanent = error; abort(); return; }
          }
        }
      })();
      await readDeskEventStream(response, connection.signal, event => {
        const next = parseDeskCursor(event.id)!;
        const previous = cursor ? parseDeskCursor(cursor)! : null;
        if (previous) {
          if (next.scope !== previous.scope || (next.offset === previous.offset && event.id !== cursor)) {
            throw new PermanentStreamError('Desk stream changed. Reload this run.');
          }
          if (next.offset <= previous.offset) return;
        }
        options.onEvent(event);
        cursor = event.id;
        progressed = true;
      }, activity);
    } catch (error) {
      if (error instanceof PermanentStreamError) permanent = error;
      // Network errors, EOF and transient HTTP failures reconnect below.
    } finally {
      abort();
      clearTimeout(watchdog);
      await poll;
      options.signal.removeEventListener('abort', abort);
    }
    if (options.signal.aborted) return;
    if (permanent) { options.onError(permanent.message); return; }
    // EOF, including ticker done/error, is never a substitute for aggregate reconciliation.
    const reconcile = new AbortController();
    const stop = () => reconcile.abort();
    options.signal.addEventListener('abort', stop, { once: true });
    const timer = setTimeout(stop, 10_000);
    try { await refresh(reconcile.signal); } catch (error) {
      if (!options.signal.aborted && error instanceof PermanentStreamError) {
        options.onError(error.message); return;
      }
    } finally {
      clearTimeout(timer);
      options.signal.removeEventListener('abort', stop);
    }
    if (options.signal.aborted || terminal) return;
    if (progressed) delay = 500;
    await deskStreamDelay(delay, options.signal);
    delay = Math.min(delay * 2, 10_000);
  }
}
