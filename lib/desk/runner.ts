// Next.js cannot keep a minutes-long TradingAgents graph on the creating
// request: `next dev` HMR kills in-process children, an SSE drop must not
// abort the firm, and runPython/execFile impose a 30s timeout. Self-hosted
// Node is not serverless, but POST still returns 201 immediately. Spawn
// detached, capture stdout into {resultsDir}/events.jsonl, and let GET
// /api/desk/runs/[id]/stream replay then tail that file. Serverless unsupported.
// Sequential tickers: one TradingAgentsGraph child at a time per DeskRun.

import 'server-only';

import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { Prisma } from '@prisma/client';
import {
  deskCacheDir,
  deskDataRoot,
  deskMemoryLogPath,
  deskResultsDir,
  deskTimeoutMessage,
  deskWallMs,
} from '@/lib/desk/config';
import { redactDeskSecrets } from '@/lib/desk/redact';
import { deskHasMoreTickers, parseDeskDepth, type DeskDepth, type DeskRunStatus, type DeskSignal } from '@/lib/desk/types';
import { prisma } from '@/lib/prisma';

const SCRIPT = path.join(process.cwd(), 'scripts', 'trading_desk_runner.py');
const TRADINGAGENTS_DIR = path.join(process.cwd(), 'TradingAgents');
const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_DEEP_MODEL = 'deepseek/deepseek-v4-pro';
const DEFAULT_QUICK_MODEL = 'google/gemini-3.5-flash';

type DeskChildMeta = {
  child: ChildProcess | null;
  tickerIndex: number;
  timedOut: boolean;
  wallTimer?: ReturnType<typeof setTimeout>;
  extraSecrets: string[];
};

const globalForDesk = globalThis as unknown as {
  deskChildren?: Map<string, DeskChildMeta>;
};

function deskChildren(): Map<string, DeskChildMeta> {
  if (!globalForDesk.deskChildren) globalForDesk.deskChildren = new Map();
  return globalForDesk.deskChildren;
}

/** Same existsSync candidate loop as lib/python-runner.ts, pointed at TradingAgents/.venv. */
function getDeskPythonExecutable(): string {
  const candidates =
    process.platform === 'win32'
      ? [path.join(TRADINGAGENTS_DIR, '.venv', 'Scripts', 'python.exe')]
      : [
          path.join(TRADINGAGENTS_DIR, '.venv', 'bin', 'python3'),
          path.join(TRADINGAGENTS_DIR, '.venv', 'bin', 'python'),
        ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error(
    `TradingAgents venv python not found (looked in ${candidates.join(', ')}). Desk does not use the app .venv.`,
  );
}

export function deskEventsPath(resultsDir: string): string {
  return path.join(resultsDir, 'events.jsonl');
}

export function deskOutPath(resultsDir: string): string {
  return path.join(resultsDir, 'out.json');
}

export function deskPidPath(resultsDir: string): string {
  return path.join(resultsDir, 'pid');
}

export function parseDeskRunStatus(value: string): DeskRunStatus | null {
  switch (value) {
    case 'queued':
    case 'running':
    case 'completed':
    case 'failed':
    case 'cancelled':
    case 'review':
      return value;
    default:
      return null;
  }
}

export function isTerminalDeskStatus(status: DeskRunStatus): boolean {
  switch (status) {
    case 'completed':
    case 'failed':
    case 'cancelled':
    case 'review':
      return true;
    case 'queued':
    case 'running':
      return false;
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

export function jsonlToSseName(event: string): string | null {
  switch (event) {
    case 'phase':
      return 'desk_phase';
    case 'agent':
      return 'desk_agent';
    case 'memo':
      return 'desk_memo';
    case 'debate':
      return 'desk_debate';
    case 'decision':
      return 'desk_decision';
    case 'done':
      return 'desk_done';
    case 'error':
      return 'desk_error';
    default:
      return null;
  }
}

export function parseDeskJsonlLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function jsonlEventName(row: Record<string, unknown>): string | null {
  return typeof row.event === 'string' ? row.event : null;
}

function isRunTerminalJsonl(row: Record<string, unknown>): boolean {
  // Per-ticker `done` is not run-terminal: remaining tickers still append JSONL.
  return jsonlEventName(row) === 'error';
}

export type StartDeskRunInput = {
  id: string;
  userId: string;
  tickers: string[];
  asOf: string;
  depth: string;
  analysts: string[];
  assetType: string;
  checkpoint: boolean;
  openRouterKey: string;
};

export function isDeskPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    return code === 'EPERM';
  }
}

export async function startDeskRun(input: StartDeskRunInput): Promise<void> {
  if (input.tickers.length < 1) throw new Error('At least one ticker is required');

  const resultsDir = deskResultsDir(input.userId, input.id);
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.mkdirSync(path.dirname(deskMemoryLogPath(input.userId)), { recursive: true });
  fs.mkdirSync(deskCacheDir(input.userId), { recursive: true });
  fs.writeFileSync(deskEventsPath(resultsDir), '');

  await spawnTicker(input, 0);
}

async function spawnTicker(input: StartDeskRunInput, tickerIndex: number): Promise<void> {
  const ticker = input.tickers[tickerIndex];
  if (!ticker) throw new Error('At least one ticker is required');
  const existing = deskChildren().get(input.id);
  if (existing?.child) {
    throw new Error('A TradingAgentsGraph process is already running for this Desk run');
  }

  const depth = parseDeskDepth(input.depth) ?? 'standard';
  const python = getDeskPythonExecutable();
  const resultsDir = deskResultsDir(input.userId, input.id);
  const memoryLogPath = deskMemoryLogPath(input.userId);
  const cacheDir = deskCacheDir(input.userId);
  const eventsPath = deskEventsPath(resultsDir);
  const outPath = deskOutPath(resultsDir);
  const stderrPath = path.join(resultsDir, 'stderr.log');

  if (tickerIndex > 0 && fs.existsSync(outPath)) {
    const previous = input.tickers[tickerIndex - 1];
    if (previous) {
      fs.copyFileSync(outPath, path.join(resultsDir, `out-${previous}.json`));
    }
    fs.unlinkSync(outPath);
  }

  const eventsFd = fs.openSync(eventsPath, 'a');
  const stderrFd = fs.openSync(stderrPath, 'a');

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OPENROUTER_API_KEY: input.openRouterKey,
    OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL?.trim() || DEFAULT_OPENROUTER_BASE_URL,
    DESK_DEEP_MODEL: process.env.DESK_DEEP_MODEL?.trim() || DEFAULT_DEEP_MODEL,
    DESK_QUICK_MODEL: process.env.DESK_QUICK_MODEL?.trim() || DEFAULT_QUICK_MODEL,
    DESK_DATA_ROOT: deskDataRoot(),
    PYTHONPATH: TRADINGAGENTS_DIR,
    TRADINGAGENTS_RESULTS_DIR: resultsDir,
    TRADINGAGENTS_CACHE_DIR: cacheDir,
    TRADINGAGENTS_MEMORY_LOG_PATH: memoryLogPath,
    TRADINGAGENTS_CHECKPOINT_ENABLED: input.checkpoint ? 'true' : 'false',
  };

  const args = [
    SCRIPT,
    '--ticker',
    ticker,
    '--as-of',
    input.asOf,
    '--depth',
    input.depth,
    '--analysts',
    input.analysts.join(','),
    '--asset-type',
    input.assetType,
    '--checkpoint',
    input.checkpoint ? 'true' : 'false',
    '--out',
    outPath,
    '--results-dir',
    resultsDir,
    '--memory-log-path',
    memoryLogPath,
    '--data-cache-dir',
    cacheDir,
  ];

  let child: ChildProcess;
  try {
    child = spawn(python, args, {
      cwd: process.cwd(),
      env,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', eventsFd, stderrFd],
    });
    await waitForSpawn(child);
  } catch (error) {
    closeFd(eventsFd);
    closeFd(stderrFd);
    throw redactError(error, [input.openRouterKey]);
  }
  closeFd(eventsFd);
  closeFd(stderrFd);

  if (child.pid == null) {
    throw new Error('Desk runner spawned without a pid');
  }

  fs.writeFileSync(deskPidPath(resultsDir), String(child.pid), 'utf8');

  const extraSecrets = [input.openRouterKey];
  const meta: DeskChildMeta = {
    child,
    tickerIndex,
    timedOut: false,
    extraSecrets,
  };
  const wallMs = deskWallMs(depth);
  meta.wallTimer = setTimeout(() => {
    void onWallTimeout(input, tickerIndex, ticker, depth, wallMs);
  }, wallMs);
  deskChildren().set(input.id, meta);

  await prisma.deskRun.update({
    where: { id: input.id },
    data: { status: 'running', activeTicker: ticker },
  });

  child.on('exit', () => {
    void onTickerExit(input, tickerIndex);
  });
  child.unref();
}

async function onWallTimeout(
  input: StartDeskRunInput,
  tickerIndex: number,
  ticker: string,
  depth: DeskDepth,
  wallMs: number,
): Promise<void> {
  const meta = deskChildren().get(input.id);
  if (!meta || meta.tickerIndex !== tickerIndex || meta.timedOut) return;
  meta.timedOut = true;
  if (meta.wallTimer) clearTimeout(meta.wallTimer);

  const message = deskTimeoutMessage({
    depth,
    ticker,
    wallMs,
    checkpoint: input.checkpoint,
  });
  await prisma.deskRun.updateMany({
    where: { id: input.id, userId: input.userId, status: { in: ['queued', 'running'] } },
    data: { status: 'failed', error: message, finishedAt: new Date() },
  });

  meta.child?.kill();
  killPidFile(deskResultsDir(input.userId, input.id));
}

async function onTickerExit(input: StartDeskRunInput, tickerIndex: number): Promise<void> {
  const meta = deskChildren().get(input.id);
  if (meta?.tickerIndex === tickerIndex) {
    if (meta.wallTimer) clearTimeout(meta.wallTimer);
    meta.child = null;
    // Keep the map entry so the pid reaper cannot treat ticker N's out.json as
    // run completion while we are about to spawn ticker N+1.
  }
  if (meta?.timedOut) {
    deskChildren().delete(input.id);
    return;
  }

  const run = await prisma.deskRun.findFirst({ where: { id: input.id, userId: input.userId } });
  if (!run) {
    deskChildren().delete(input.id);
    return;
  }
  const status = parseDeskRunStatus(run.status);
  if (!status || isTerminalDeskStatus(status)) {
    deskChildren().delete(input.id);
    return;
  }

  const resultsDir = deskResultsDir(input.userId, input.id);
  const last = lastJsonlEvents(deskEventsPath(resultsDir), meta?.extraSecrets ?? [input.openRouterKey]);
  const out = readOutFile(deskOutPath(resultsDir));

  if (last.errorMessage || !out) {
    deskChildren().delete(input.id);
    await finalizeDeskRun(input.id, input.userId, meta?.extraSecrets ?? [input.openRouterKey]);
    return;
  }

  if (tickerIndex + 1 < input.tickers.length) {
    try {
      await spawnTicker(input, tickerIndex + 1);
    } catch (error) {
      deskChildren().delete(input.id);
      const message = redactDeskSecrets(
        error instanceof Error ? error.message : 'Desk runner failed to start next ticker',
        [input.openRouterKey],
      );
      await prisma.deskRun.updateMany({
        where: { id: input.id, userId: input.userId, status: { in: ['queued', 'running'] } },
        data: { status: 'failed', error: message, finishedAt: new Date() },
      });
    }
    return;
  }

  deskChildren().delete(input.id);
  await finalizeDeskRun(input.id, input.userId, meta?.extraSecrets ?? [input.openRouterKey]);
}

export async function cancelDeskRun(runId: string, userId: string) {
  const run = await prisma.deskRun.findFirst({ where: { id: runId, userId } });
  if (!run) return null;

  const status = parseDeskRunStatus(run.status);
  if (status && isTerminalDeskStatus(status)) return run;

  const resultsDir = deskResultsDir(userId, runId);
  await prisma.deskRun.updateMany({
    where: { id: runId, userId, status: { in: ['queued', 'running'] } },
    data: { status: 'cancelled', finishedAt: new Date() },
  });

  const meta = deskChildren().get(runId);
  if (meta) {
    if (meta.wallTimer) clearTimeout(meta.wallTimer);
    meta.child?.kill();
    deskChildren().delete(runId);
  }
  killPidFile(resultsDir);

  return prisma.deskRun.findFirst({ where: { id: runId, userId } });
}

export async function finalizeDeskRun(
  runId: string,
  userId: string,
  extraSecrets: string[] = [],
): Promise<void> {
  const run = await prisma.deskRun.findFirst({ where: { id: runId, userId } });
  if (!run) return;
  const status = parseDeskRunStatus(run.status);
  if (!status || isTerminalDeskStatus(status)) return;

  const resultsDir = deskResultsDir(userId, runId);
  const out = readOutFile(deskOutPath(resultsDir));
  const last = lastJsonlEvents(deskEventsPath(resultsDir), extraSecrets);

  if (out && !last.errorMessage) {
    const signal = parseDeskSignal(out.signal);
    await prisma.deskRun.updateMany({
      where: { id: runId, userId, status: { in: ['queued', 'running'] } },
      data: {
        status: signal === 'REVIEW' ? 'review' : 'completed',
        signal: signal ?? out.signal,
        ...(out.finalState !== undefined
          ? { finalState: out.finalState as Prisma.InputJsonValue }
          : {}),
        finishedAt: new Date(),
      },
    });
    return;
  }

  const errorMessage = redactDeskSecrets(
    last.errorMessage || 'Desk runner exited without writing out.json',
    extraSecrets,
  );
  await prisma.deskRun.updateMany({
    where: { id: runId, userId, status: { in: ['queued', 'running'] } },
    data: { status: 'failed', error: errorMessage, finishedAt: new Date() },
  });
}

/** If Node restarted and the pid file's process is gone, flip stuck running → failed (or complete from out.json). */
export async function reapOrphanDeskRuns(userId: string): Promise<void> {
  const stuck = await prisma.deskRun.findMany({
    where: { userId, status: { in: ['queued', 'running'] } },
    select: {
      id: true,
      userId: true,
      status: true,
      createdAt: true,
      tickers: true,
      activeTicker: true,
    },
  });

  for (const run of stuck) {
    if (deskChildren().has(run.id)) continue;
    if (run.status === 'queued' && Date.now() - run.createdAt.getTime() < 15_000) continue;

    const resultsDir = deskResultsDir(run.userId, run.id);
    const pid = readPidFile(resultsDir);
    if (pid != null && isDeskPidAlive(pid)) continue;

    if (deskHasMoreTickers(run.tickers, run.activeTicker)) {
      await prisma.deskRun.updateMany({
        where: { id: run.id, userId: run.userId, status: { in: ['queued', 'running'] } },
        data: {
          status: 'failed',
          error: 'Desk runner process is gone after a server restart.',
          finishedAt: new Date(),
        },
      });
      continue;
    }

    await finalizeDeskRun(run.id, run.userId);
    const after = await prisma.deskRun.findFirst({
      where: { id: run.id, userId: run.userId },
      select: { status: true },
    });
    const afterStatus = after ? parseDeskRunStatus(after.status) : null;
    if (afterStatus && isTerminalDeskStatus(afterStatus)) continue;

    await prisma.deskRun.updateMany({
      where: { id: run.id, userId: run.userId, status: { in: ['queued', 'running'] } },
      data: {
        status: 'failed',
        error: 'Desk runner process is gone after a server restart.',
        finishedAt: new Date(),
      },
    });
  }
}

export async function* followDeskJsonl(
  eventsPath: string,
  opts: { signal?: AbortSignal; isFinished: () => Promise<boolean> },
): AsyncGenerator<Record<string, unknown>> {
  let offset = 0;
  let pending = '';
  let terminal = false;

  const drain = (): Record<string, unknown>[] => {
    if (!fs.existsSync(eventsPath)) return [];
    const stat = fs.statSync(eventsPath);
    if (stat.size <= offset) return [];
    const length = stat.size - offset;
    const buf = Buffer.alloc(length);
    const fd = fs.openSync(eventsPath, 'r');
    fs.readSync(fd, buf, 0, length, offset);
    fs.closeSync(fd);
    offset = stat.size;
    pending += buf.toString('utf8');
    const parts = pending.split(/\r?\n/);
    pending = parts.pop() ?? '';
    const rows: Record<string, unknown>[] = [];
    for (const line of parts) {
      const parsed = parseDeskJsonlLine(line);
      if (!parsed) continue;
      rows.push(parsed);
      if (isRunTerminalJsonl(parsed)) terminal = true;
    }
    return rows;
  };

  while (!opts.signal?.aborted && !terminal) {
    for (const row of drain()) yield row;
    if (terminal || opts.signal?.aborted) return;
    if (await opts.isFinished()) {
      for (const row of drain()) yield row;
      return;
    }
    await sleep(400, opts.signal);
  }
}

function redactError(error: unknown, extraSecrets: string[]): Error {
  const message = redactDeskSecrets(error instanceof Error ? error.message : String(error), extraSecrets);
  return new Error(message);
}

function waitForSpawn(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      child.off('spawn', onSpawn);
      reject(error);
    };
    const onSpawn = () => {
      child.off('error', onError);
      resolve();
    };
    child.once('error', onError);
    child.once('spawn', onSpawn);
  });
}

function closeFd(fd: number) {
  try {
    fs.closeSync(fd);
  } catch {
    // already closed
  }
}

function killPidFile(resultsDir: string) {
  const pid = readPidFile(resultsDir);
  if (pid == null) return;
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // already gone
  }
}

function readPidFile(resultsDir: string): number | null {
  const pidPath = deskPidPath(resultsDir);
  if (!fs.existsSync(pidPath)) return null;
  const pid = Number.parseInt(fs.readFileSync(pidPath, 'utf8').trim(), 10);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  return pid;
}

function readOutFile(outPath: string): { signal?: string; finalState?: unknown } | null {
  if (!fs.existsSync(outPath)) return null;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const row = parsed as { signal?: unknown; finalState?: unknown };
    return {
      signal: typeof row.signal === 'string' ? row.signal : undefined,
      finalState: row.finalState,
    };
  } catch {
    return null;
  }
}

function lastJsonlEvents(eventsPath: string, extraSecrets: string[]): { errorMessage: string | null } {
  if (!fs.existsSync(eventsPath)) return { errorMessage: null };
  const text = fs.readFileSync(eventsPath, 'utf8');
  let errorMessage: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseDeskJsonlLine(line);
    if (!parsed) continue;
    if (jsonlEventName(parsed) === 'error' && typeof parsed.message === 'string') {
      errorMessage = redactDeskSecrets(parsed.message, extraSecrets);
    }
  }
  return { errorMessage };
}

function parseDeskSignal(value: string | undefined): DeskSignal | null {
  switch (value) {
    case 'Buy':
    case 'Overweight':
    case 'Hold':
    case 'Underweight':
    case 'Sell':
    case 'REVIEW':
      return value;
    default:
      return null;
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
