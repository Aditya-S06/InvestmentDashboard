import fs from 'fs';
import path from 'path';

import { isDeskTicker, type DeskDepth } from './types';

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

// Production deadlines and timeout messages live in scripts/desk_supervisor.py.
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

export function isSafeDeskTicker(ticker: string): boolean {
  return isDeskTicker(ticker);
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
  if (!/^[A-Za-z0-9_-]+$/.test(userId)) throw new Error('Invalid user path');
  const root = path.resolve(deskUserDir(userId));
  const resolved = path.resolve(target);
  let current = resolved;
  while (path.dirname(current) !== current) {
    if (fs.lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('Linked checkpoints unsupported');
    current = path.dirname(current);
  }
  const rel = path.relative(root, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Checkpoint path escapes the user directory');
  }
}

export function listDeskCheckpointTickers(userId: string): string[] {
  const dir = deskCheckpointDir(userId);
  assertInsideUserDir(userId, dir);
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
