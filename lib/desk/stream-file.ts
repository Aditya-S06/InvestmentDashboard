import 'server-only';
import fs from 'fs';
import { createHash } from 'crypto';
import { deskStreamDelay, parseDeskCursor } from './stream-protocol';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export const deskCursorScope = (userId: string, runId: string) => hash(JSON.stringify([userId, runId]));
export class InvalidDeskCursor extends Error {
  constructor() { super('Invalid or stale Desk stream cursor; reload the run.'); }
}

export function parseDeskJsonlLine(line: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(line);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

/** Called only after route authorization and path validation. No path comes from the cursor. */
export function validateDeskCursor(file: string, scope: string, cursor: string | null): number {
  if (cursor === null) return 0;
  const parsed = parseDeskCursor(cursor);
  if (!parsed || parsed.scope !== scope) throw new InvalidDeskCursor();
  let fd: number;
  try { fd = fs.openSync(file, 'r'); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new InvalidDeskCursor();
    throw error;
  }
  try {
    if (parsed.offset > fs.fstatSync(fd).size) throw new InvalidDeskCursor();
    const end = Buffer.alloc(1);
    if (fs.readSync(fd, end, 0, 1, parsed.offset - 1) !== 1 || end[0] !== 10) throw new InvalidDeskCursor();
    // Locate the preceding record boundary without loading the whole log.
    let position = parsed.offset - 1;
    const parts: Buffer[] = [end];
    while (position > 0) {
      const size = Math.min(position, 64 * 1024);
      const chunk = Buffer.alloc(size);
      position -= size;
      if (fs.readSync(fd, chunk, 0, size, position) !== size) throw new InvalidDeskCursor();
      const newline = chunk.lastIndexOf(10);
      parts.unshift(chunk.subarray(newline + 1));
      if (newline >= 0) break;
    }
    const line = Buffer.concat(parts);
    if (hash(line) !== parsed.digest || !parseDeskJsonlLine(line.toString('utf8'))) throw new InvalidDeskCursor();
    return parsed.offset;
  } finally { fs.closeSync(fd); }
}

/** Decode only whole lines: incomplete UTF-8 and partial JSON survive every file read. */
export async function* followDeskJsonl(
  file: string,
  opts: { scope: string; after?: string | null; signal?: AbortSignal; isFinished: () => Promise<boolean> },
): AsyncGenerator<{ id: string; data: Record<string, unknown> }> {
  const signal = opts.signal ?? new AbortController().signal;
  let offset = validateDeskCursor(file, opts.scope, opts.after ?? null);
  let pending = Buffer.alloc(0);
  async function* drain() {
    let fd: number;
    try { fd = fs.openSync(file, 'r'); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && offset === 0) return;
      throw error;
    }
    try {
      const size = fs.fstatSync(fd).size;
      if (size < offset) throw new InvalidDeskCursor();
      while (offset < size && !signal.aborted) {
        const chunk = Buffer.alloc(Math.min(64 * 1024, size - offset));
        const count = fs.readSync(fd, chunk, 0, chunk.length, offset);
        if (!count) throw new InvalidDeskCursor();
        offset += count;
        pending = Buffer.concat([pending, chunk.subarray(0, count)]);
        let newline: number;
        while ((newline = pending.indexOf(10)) >= 0 && !signal.aborted) {
          const line = pending.subarray(0, newline + 1);
          pending = pending.subarray(newline + 1);
          const data = parseDeskJsonlLine(line.toString('utf8'));
          if (data) yield { id: `v1.${opts.scope}.${offset - pending.length}.${hash(line)}`, data };
        }
        // Let aborts run even through a backlog of malformed/unsupported lines.
        await deskStreamDelay(0, signal);
      }
    } finally { fs.closeSync(fd); }
  }
  while (!signal.aborted) {
    yield* drain();
    if (signal.aborted) return;
    if (await opts.isFinished()) {
      yield* drain();
      // A non-newline-terminated tail is uncommitted and never gets a cursor.
      return;
    }
    await deskStreamDelay(400, signal);
  }
}
