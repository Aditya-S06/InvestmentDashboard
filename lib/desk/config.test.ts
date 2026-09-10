import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearDeskCheckpointFile,
  deskCacheDir,
  deskCheckpointFile,
  deskHasCheckpoint,
  deskMemoryLogPath,
  deskResultsDir,
  deskTimeoutMessage,
  deskUserDir,
  deskWallMs,
  listDeskCheckpointTickers,
} from '@/lib/desk/config';
import { deskHasMoreTickers, formatDeskTickerHeader } from '@/lib/desk/types';

describe('desk isolation paths', () => {
  const previous = process.env.DESK_DATA_ROOT;
  let root: string;

  function useTempRoot() {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-harden-'));
    process.env.DESK_DATA_ROOT = root;
  }

  afterEach(() => {
    if (previous === undefined) delete process.env.DESK_DATA_ROOT;
    else process.env.DESK_DATA_ROOT = previous;
    if (root && fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('keeps results per run and memory/cache per user, never under ~/.tradingagents', () => {
    useTempRoot();
    const userId = 'user-a';
    const runId = 'run-1';
    expect(deskResultsDir(userId, runId)).toBe(path.join(root, userId, runId));
    expect(deskMemoryLogPath(userId)).toBe(path.join(root, userId, 'trading_memory.md'));
    expect(deskCacheDir(userId)).toBe(path.join(root, userId, 'cache'));
    expect(deskUserDir(userId)).not.toContain('.tradingagents');
    expect(deskCheckpointFile(userId, 'nvda')).toBe(
      path.join(root, userId, 'cache', 'checkpoints', 'NVDA.db'),
    );
  });

  it('lists and clears only that user ticker checkpoint file', () => {
    useTempRoot();
    const fileA = deskCheckpointFile('user-a', 'NVDA');
    const fileB = deskCheckpointFile('user-b', 'NVDA');
    fs.mkdirSync(path.dirname(fileA), { recursive: true });
    fs.mkdirSync(path.dirname(fileB), { recursive: true });
    fs.writeFileSync(fileA, 'a');
    fs.writeFileSync(fileB, 'b');

    expect(listDeskCheckpointTickers('user-a')).toEqual(['NVDA']);
    expect(deskHasCheckpoint('user-a', 'NVDA')).toBe(true);
    expect(clearDeskCheckpointFile('user-a', 'NVDA')).toBe(true);
    expect(deskHasCheckpoint('user-a', 'NVDA')).toBe(false);
    expect(fs.existsSync(fileB)).toBe(true);
  });
});

describe('desk wall and header', () => {
  it('does not use 90s for deep', () => {
    expect(deskWallMs('fast')).toBe(90_000);
    expect(deskWallMs('deep')).toBe(300_000);
    expect(deskWallMs('deep')).toBeGreaterThan(deskWallMs('fast'));
  });

  it('mentions resume only when checkpoint was on', () => {
    const timedOut = deskTimeoutMessage({
      depth: 'fast',
      ticker: 'NVDA',
      wallMs: 90_000,
      checkpoint: false,
    });
    expect(timedOut).toContain('timed out after 90s');
    expect(timedOut).not.toContain('resume');

    const resume = deskTimeoutMessage({
      depth: 'deep',
      ticker: 'NVDA',
      wallMs: 300_000,
      checkpoint: true,
    });
    expect(resume).toContain('300s');
    expect(resume).toContain('deep');
    expect(resume.toLowerCase()).toContain('resume');
  });

  it('formats a live multi-ticker header as NVDA 1/2', () => {
    expect(formatDeskTickerHeader(['NVDA', 'AAPL'], 'NVDA')).toBe('NVDA 1/2');
    expect(formatDeskTickerHeader(['NVDA', 'AAPL'], 'AAPL')).toBe('AAPL 2/2');
    expect(formatDeskTickerHeader(['NVDA', 'AAPL'], null)).toBe('NVDA, AAPL');
    expect(formatDeskTickerHeader(['NVDA'], 'NVDA')).toBe('NVDA');
    expect(deskHasMoreTickers(['NVDA', 'AAPL'], 'NVDA')).toBe(true);
    expect(deskHasMoreTickers(['NVDA', 'AAPL'], 'AAPL')).toBe(false);
    expect(deskHasMoreTickers(['NVDA'], 'NVDA')).toBe(false);
  });
});
