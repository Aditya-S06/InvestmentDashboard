import fs from 'fs';
import path from 'path';

import type { DeskDepth } from './types';

/** depth → max_debate_rounds and max_risk_discuss_rounds. */
export const DEPTH_ROUNDS: Record<DeskDepth, number> = { fast: 1, standard: 3, deep: 5 };

/**
 * Desk uses its own weighted hourly limiter (`lib/desk/rate-limit.ts`), not the
 * Insights limiter. `lib/insights/rate-limit.ts` is gitignored and must stay
 * byte-compatible with the Insights harness; importing or editing it from Desk
 * would couple the two products. Weights: fast=1, standard=2, deep=3 against
 * `DESK_RATE_LIMIT_PER_HOUR` (default 4). A 429 names bucket `desk` and remaining.
 */
export const RATE_WEIGHT: Record<DeskDepth, number> = { fast: 1, standard: 2, deep: 3 };

/** Default hourly Desk budget. Override with DESK_RATE_LIMIT_PER_HOUR. */
export const DESK_RATE_LIMIT_PER_HOUR_DEFAULT = 4;

/**
 * Per-ticker wall-clock limits. Deep must not inherit fast's 90s — a Deep graph
 * can exceed 90s. Standard sits between them. Applied to each sequential ticker,
 * not the whole multi-ticker run.
 */
export const DESK_WALL_MS: Record<DeskDepth, number> = {
  fast: 90_000,
  standard: 180_000,
  deep: 300_000,
};

const TICKER_PATH_RE = /^[A-Za-z0-9._^=+-]+$/;

/** Root for Desk run artifacts: DESK_DATA_ROOT, or <repo>/.data/desk (gitignored). */
export function deskDataRoot(): string {
  const configured = process.env.DESK_DATA_ROOT?.trim();
  return configured ? path.resolve(configured) : path.join(process.cwd(), '.data', 'desk');
}

/** {root}/{userId} — memory log, cache, and checkpoints live here, never ~/.tradingagents. */
export function deskUserDir(userId: string): string {
  return path.join(deskDataRoot(), userId);
}

/** results_dir for a single run: {root}/{userId}/{runId}. */
export function deskResultsDir(userId: string, runId: string): string {
  return path.join(deskUserDir(userId), runId);
}

/** memory_log_path: {root}/{userId}/trading_memory.md (shared across that user's runs). */
export function deskMemoryLogPath(userId: string): string {
  return path.join(deskUserDir(userId), 'trading_memory.md');
}

/** Tauric data_cache_dir (csv + sqlite checkpoints): {root}/{userId}/cache. */
export function deskCacheDir(userId: string): string {
  return path.join(deskUserDir(userId), 'cache');
}

/** Per-ticker sqlite lives at {root}/{userId}/cache/checkpoints/{TICKER}.db. */
export function deskCheckpointDir(userId: string): string {
  return path.join(deskCacheDir(userId), 'checkpoints');
}

export function deskRateLimitPerHour(): number {
  const raw = process.env.DESK_RATE_LIMIT_PER_HOUR?.trim();
  if (!raw) return DESK_RATE_LIMIT_PER_HOUR_DEFAULT;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DESK_RATE_LIMIT_PER_HOUR_DEFAULT;
}

export function deskWallMs(depth: DeskDepth): number {
  switch (depth) {
    case 'fast':
    case 'standard':
    case 'deep':
      return DESK_WALL_MS[depth];
    default: {
      const _exhaustive: never = depth;
      return _exhaustive;
    }
  }
}

export function deskTimeoutMessage(opts: {
  depth: DeskDepth;
  ticker: string;
  wallMs: number;
  checkpoint: boolean;
}): string {
  const seconds = Math.round(opts.wallMs / 1000);
  const base = `Desk run timed out after ${seconds}s (${opts.depth}) while analyzing ${opts.ticker}.`;
  if (opts.checkpoint) {
    return `${base} A checkpoint was enabled — re-run this ticker to resume.`;
  }
  return base;
}

export function isSafeDeskTicker(ticker: string): boolean {
  if (!ticker || ticker.length > 10) return false;
  if (setEqualsDots(ticker)) return false;
  return TICKER_PATH_RE.test(ticker);
}

function setEqualsDots(value: string): boolean {
  for (const ch of value) {
    if (ch !== '.') return false;
  }
  return value.length > 0;
}

export function requireSafeDeskTicker(ticker: string): string {
  const normalized = ticker.trim().toUpperCase();
  if (!isSafeDeskTicker(normalized)) {
    throw new Error('Invalid ticker');
  }
  return normalized;
}

export function deskCheckpointFile(userId: string, ticker: string): string {
  return path.join(deskCheckpointDir(userId), `${requireSafeDeskTicker(ticker)}.db`);
}

function assertInsideUserDir(userId: string, target: string) {
  const root = path.resolve(deskUserDir(userId));
  const resolved = path.resolve(target);
  const rel = path.relative(root, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Checkpoint path escapes the user directory');
  }
}

export function listDeskCheckpointTickers(userId: string): string[] {
  const dir = deskCheckpointDir(userId);
  if (!fs.existsSync(dir)) return [];
  const found: string[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.db') || name.endsWith('-wal') || name.endsWith('-shm')) continue;
    const ticker = name.slice(0, -'.db'.length).toUpperCase();
    if (!isSafeDeskTicker(ticker)) continue;
    const file = path.join(dir, name);
    try {
      assertInsideUserDir(userId, file);
    } catch {
      continue;
    }
    if (fs.statSync(file).isFile()) found.push(ticker);
  }
  return found.sort();
}

/** Deletes only this user's per-ticker sqlite (and wal/shm), never another user or ~/.tradingagents. */
export function clearDeskCheckpointFile(userId: string, ticker: string): boolean {
  const file = deskCheckpointFile(userId, ticker);
  assertInsideUserDir(userId, file);
  let deleted = false;
  for (const candidate of [file, `${file}-wal`, `${file}-shm`]) {
    if (!fs.existsSync(candidate)) continue;
    fs.unlinkSync(candidate);
    deleted = true;
  }
  return deleted;
}

export function deskHasCheckpoint(userId: string, ticker: string): boolean {
  if (!isSafeDeskTicker(ticker.trim().toUpperCase())) return false;
  const file = deskCheckpointFile(userId, ticker);
  try {
    assertInsideUserDir(userId, file);
  } catch {
    return false;
  }
  return fs.existsSync(file);
}
