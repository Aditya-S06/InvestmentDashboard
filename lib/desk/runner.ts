// Detached local Python supervision owns sequencing, deadlines and process containment.
// Next only launches once and reconciles atomic snapshots; no graph timer or PID signalling.
import 'server-only';

import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import { randomUUID } from 'crypto';
import path from 'path';
import type { Prisma } from '@prisma/client';
import {
  deskCacheDir,
  deskDataRoot,
  deskMemoryLogPath,
  deskResultsDir,
} from '@/lib/desk/config';
import { isDeskDate, isDeskTicker, parseDeskDepth, type DeskRunStatus, type DeskTickerResult } from '@/lib/desk/types';
import { prisma } from '@/lib/prisma';
import { DESK_RECONCILE_FRESH_MS } from './limits';
import { runtimeEnv } from '@/lib/subprocess-env';
import { aggregateDeskResults, curateDeskState, deskRunResults, emptyDeskResults, hasDeskResults, isAvailableDeskResult, packDeskResults, parseDeskSignalText, type DeskResultRun } from './report';

const SCRIPT = path.join(process.cwd(), 'scripts', 'desk_supervisor.py');
const TRADINGAGENTS_DIR = path.join(process.cwd(), 'TradingAgents');
const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_DEEP_MODEL = 'deepseek/deepseek-v4-pro';
const DEFAULT_QUICK_MODEL = 'google/gemini-3.5-flash';

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

export { followDeskJsonl, parseDeskJsonlLine } from './stream-file';

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
  resume?: import('./types').DeskCheckpointReference;
};

/** No environments, credentials, models or executable overrides enter this manifest. */
export async function startDeskRun(input: StartDeskRunInput): Promise<void> {
  input = { ...input, tickers: [...new Set(input.tickers.map(ticker => ticker.trim().toUpperCase()))] };
  if (input.tickers.length < 1 || input.tickers.length > 3 || input.tickers.some(ticker => !isDeskTicker(ticker))) throw new Error('Invalid tickers');
  if (!isDeskDate(input.asOf) || !parseDeskDepth(input.depth)) throw new Error('Invalid Desk date/depth');
  validateDeskArtifactPaths(input.userId, input.id, input.tickers);
  const run = await prisma.deskRun.findFirst({ where: { id: input.id, userId: input.userId } });
  if (!run || run.status !== 'queued') return;
  const python = getDeskPythonExecutable();
  const resultsDir = deskResultsDir(input.userId, input.id);
  const memoryLogPath = deskMemoryLogPath(input.userId);
  const cacheDir = deskCacheDir(input.userId);
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  // Exclusive permanent claim: a repeated launch must never reset state or replay.
  if (fs.existsSync(path.join(resultsDir, 'manifest.json'))) return;
  let claim: number;
  try { claim = fs.openSync(path.join(resultsDir, 'launch'), 'wx'); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return;
    throw error;
  }
  fs.closeSync(claim);
  const jobId = randomUUID().replace(/-/g, '');
  const manifest = { version: 1, jobId, id: input.id, userId: input.userId,
    tickers: input.tickers, asOf: input.asOf, depth: input.depth, analysts: input.analysts,
    assetType: input.assetType, checkpoint: input.checkpoint, ...(input.resume ? { resume: input.resume } : {}), createdAt: new Date().toISOString() };
  atomicDeskJson(path.join(resultsDir, 'state.json'), { ...manifest, revision: 0, status: 'queued',
    activeTicker: null, deadline: null, error: null, finishedAt: null, results: emptyDeskResults(input.tickers) });
  atomicDeskJson(path.join(resultsDir, 'manifest.json'), manifest);
  const env: NodeJS.ProcessEnv = {
    ...runtimeEnv(),
    OPENROUTER_API_KEY: input.openRouterKey,
    OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL?.trim() || DEFAULT_OPENROUTER_BASE_URL,
    DESK_DEEP_MODEL: process.env.DESK_DEEP_MODEL?.trim() || DEFAULT_DEEP_MODEL,
    DESK_QUICK_MODEL: process.env.DESK_QUICK_MODEL?.trim() || DEFAULT_QUICK_MODEL,
    // DEFAULT_CONFIG settings that remain effective in this OpenRouter-only runner.
    TRADINGAGENTS_OUTPUT_LANGUAGE: process.env.TRADINGAGENTS_OUTPUT_LANGUAGE,
    TRADINGAGENTS_BENCHMARK_TICKER: process.env.TRADINGAGENTS_BENCHMARK_TICKER,
    TRADINGAGENTS_TEMPERATURE: process.env.TRADINGAGENTS_TEMPERATURE,
    TRADINGAGENTS_LLM_MAX_RETRIES: process.env.TRADINGAGENTS_LLM_MAX_RETRIES,
    TRADINGAGENTS_MAX_TOKENS: process.env.TRADINGAGENTS_MAX_TOKENS,
    // The default news analyst's macro-data tool uses FRED, not Alpha Vantage.
    FRED_API_KEY: process.env.FRED_API_KEY,
    PYTHONPATH: TRADINGAGENTS_DIR,
    TRADINGAGENTS_RESULTS_DIR: resultsDir,
    TRADINGAGENTS_CACHE_DIR: cacheDir,
    TRADINGAGENTS_MEMORY_LOG_PATH: memoryLogPath,
    TRADINGAGENTS_CHECKPOINT_ENABLED: input.checkpoint ? 'true' : 'false',
  };
  let child: ChildProcess;
  try {
    child = spawn(python, [SCRIPT, 'run', resultsDir], {
      cwd: process.cwd(), env, detached: true, windowsHide: true, stdio: 'ignore',
    });
    // Never retain a key in an exit listener or an unhandled async callback.
    child.on('error', () => {});
    await waitForSpawn(child);
    child.unref();
  } catch {
    throw new Error('Desk supervisor failed to start');
  }
}

function atomicDeskJson(file: string, value: unknown) {
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(temp, 'wx');
    try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, file);
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}

export class DeskCheckpointConflict extends Error {
  constructor(message: string, readonly status: 404 | 409 = 409) { super(message); }
}
export type DeskCheckpointControl = <T = unknown>(request: Record<string, unknown>) => Promise<T>;

/** Keyless OS lease spans DB checks/insertion and durable launch publication.
 * No PID-based ownership or time-expiring locks. A broken launch lease fails closed.
 */
export async function withDeskCheckpointControl<T>(userId: string, work: (control: DeskCheckpointControl) => Promise<T>): Promise<T> {
  validateDeskArtifactPaths(userId);
  const userDir = path.dirname(deskCacheDir(userId));
  fs.mkdirSync(userDir, { recursive: true });
  const child = spawn(getDeskPythonExecutable(), [path.join(process.cwd(), 'scripts', 'desk_checkpoint.py'), userDir], {
    cwd: process.cwd(), env: runtimeEnv(), windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
  });
  let pending: { resolve: (value: any) => void; reject: (error: Error) => void } | undefined;
  let buffer = '';
  let failed: Error | undefined;
  const fail = () => {
    failed = new DeskCheckpointConflict('Checkpoint coordination unavailable or busy; retry.');
    pending?.reject(failed); pending = undefined;
  };
  child.once('error', fail);
  child.once('exit', fail);
  child.stdin?.on('error', fail);
  child.stdout?.on('data', data => {
    buffer += data.toString('utf8');
    if (buffer.length > 2 * 1024 * 1024) { fail(); child.kill(); return; }
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      try {
        const value = JSON.parse(line);
        if (value.error) pending?.reject(new DeskCheckpointConflict(value.error, value.status === 404 ? 404 : 409));
        else pending?.resolve(value);
        pending = undefined;
      } catch { fail(); }
    }
  });
  const receive = () => new Promise<any>((resolve, reject) => {
    if (failed) reject(failed); else pending = { resolve, reject };
  });
  const request: DeskCheckpointControl = async command => {
    const response = receive();
    if (!failed) child.stdin?.write(`${JSON.stringify(command)}\n`);
    return (await response).result;
  };
  // Helper startup/imports may take several seconds on cold Windows storage.
  const timer = setTimeout(() => { fail(); child.kill(); }, 60_000);
  try {
    await receive();
    const result = await work(request);
    await request({ command: 'release' });
    return result;
  } finally {
    clearTimeout(timer);
    child.stdin?.end();
  }
}

type DurableSnapshot = {
  version: number; jobId: string; id: string; userId: string; revision: number;
  status: DeskRunStatus; activeTicker: string | null; error: string | null;
  finishedAt: string | null; results: DeskTickerResult[];
};

/** A short keyless helper checks OS ownership locks, never a persisted PID. */
async function deskControl(resultsDir: string, command: 'snapshot' | 'cancel'): Promise<DurableSnapshot | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(getDeskPythonExecutable(), [SCRIPT, command, resultsDir], {
      cwd: process.cwd(), env: runtimeEnv(), windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
    });
    let output = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Desk supervision control timed out; retry')); }, 10_000);
    child.stdout?.on('data', data => {
      output += data.toString('utf8');
      if (output.length > 32 * 1024 * 1024) { child.kill(); }
    });
    child.once('error', () => { clearTimeout(timer); reject(new Error('Desk supervision control unavailable')); });
    child.once('close', code => {
      clearTimeout(timer);
      if (code !== 0) { reject(new Error('Desk supervision control unavailable; retry')); return; }
      try { resolve(JSON.parse(output)); } catch { reject(new Error('Invalid Desk supervision response')); }
    });
  });
}

async function applySnapshot(runId: string, userId: string, snapshot: DurableSnapshot | null) {
  if (!snapshot) {
    await finishDeskRun(runId, userId, 'failed', 'Desk supervision state missing or corrupt; interrupted without automatic replay. Re-run with fresh authentication.');
    return;
  }
  await updateDeskResults(runId, userId, (run, previous) => {
    if (run.status !== 'queued' && run.status !== 'running') return null;
    if (snapshot.version !== 1 || snapshot.id !== runId || snapshot.userId !== userId
      || !/^[a-f0-9]{32}$/.test(snapshot.jobId) || !Number.isSafeInteger(snapshot.revision)
      || !parseDeskRunStatus(snapshot.status) || snapshot.results.length !== run.tickers.length
      || snapshot.results.some((r, i) => r.ticker !== run.tickers[i])) throw new Error('Invalid scoped Desk snapshot');
    const stored = run.finalState as { deskLifecycle?: { jobId: string; revision: number } } | null;
    const cursor = stored?.deskLifecycle;
    if (cursor && cursor.jobId !== snapshot.jobId) throw new Error('Desk job identity changed');
    // Recovery after storage corruption/clock rollback may have a lower cursor.
    // A terminal state is irreversible; preserve it even then. Active snapshots
    // still cannot regress, and the DB terminal guard makes retries idempotent.
    if (cursor && cursor.revision >= snapshot.revision && !isTerminalDeskStatus(snapshot.status)) return null;
    // A corrupt state recovery never removes already reconciled completed reports.
    const results = snapshot.results.map((row, index) => isAvailableDeskResult(previous[index]) ? previous[index] : {
      ...row, finalState: curateDeskState(row.finalState),
    });
    const terminal = isTerminalDeskStatus(snapshot.status);
    if ((snapshot.status === 'completed' || snapshot.status === 'review') && !results.every(isAvailableDeskResult)) {
      throw new Error('Incomplete Desk completion snapshot');
    }
    const aggregate = snapshot.status === 'completed' || snapshot.status === 'review' ? aggregateDeskResults(results) : null;
    return { status: aggregate?.status ?? snapshot.status, signal: aggregate?.signal ?? null,
      activeTicker: snapshot.activeTicker, error: snapshot.error,
      finishedAt: terminal && snapshot.finishedAt ? new Date(snapshot.finishedAt) : null,
      finalState: { ...packDeskResults(results), deskLifecycle: { jobId: snapshot.jobId, revision: snapshot.revision } } as Prisma.InputJsonValue };
  });
}

export async function cancelDeskRun(runId: string, userId: string) {
  const key = reconciliationKey(runId, userId);
  reconciliations.delete(key);
  try {
    const run = await prisma.deskRun.findFirst({ where: { id: runId, userId } });
    if (!run) return null;
    if (run.status !== 'queued' && run.status !== 'running') return run;
    validateDeskArtifactPaths(userId, runId);
    const directory = deskResultsDir(userId, runId);
    fs.mkdirSync(directory, { recursive: true });
    // The helper takes the operation lock even before manifest publication,
    // linearizing pre-launch cancellation with the supervisor's first spawn.
    const snapshot = await deskControl(directory, 'cancel');
    if (snapshot) await applySnapshot(runId, userId, snapshot);
    else await finishDeskRun(runId, userId, 'cancelled',
      'Cancellation recorded; no valid supervisor snapshot was available to confirm process shutdown. Legacy PID files were not signalled.');
    return prisma.deskRun.findFirst({ where: { id: runId, userId } });
  } finally {
    // A pre-cancel reader cannot republish freshness after cancellation or failure.
    reconciliations.delete(key);
  }
}

type Reconciliation = { started: number; pending: boolean; promise: Promise<void> };
// Only scoped keys, timestamps and void promises; no rows, snapshots or credentials.
const reconciliations = new Map<string, Reconciliation>();
const reconciliationKey = (runId: string, userId: string) => JSON.stringify([deskDataRoot(), userId, runId]);

/** Reconciliation cannot advance tickers or manufacture success from raw out.json. */
export function finalizeDeskRun(runId: string, userId: string, _extraSecrets: string[] = []): Promise<void> {
  const key = reconciliationKey(runId, userId);
  const now = performance.now();
  const prior = reconciliations.get(key);
  if (prior && (prior.pending || now - prior.started < DESK_RECONCILE_FRESH_MS)) return prior.promise;
  // Bound retained completed entries; in-flight work is never evicted/duplicated.
  for (const [id, entry] of reconciliations) {
    if (!entry.pending && (now - entry.started >= DESK_RECONCILE_FRESH_MS || reconciliations.size >= 512)) reconciliations.delete(id);
  }
  const entry: Reconciliation = { started: now, pending: true, promise: Promise.resolve() };
  entry.promise = reconcileDeskRun(runId, userId).then(() => { entry.pending = false; }, error => {
    if (reconciliations.get(key) === entry) reconciliations.delete(key);
    throw error;
  });
  reconciliations.set(key, entry);
  return entry.promise;
}

async function reconcileDeskRun(runId: string, userId: string): Promise<void> {
  const run = await prisma.deskRun.findFirst({ where: { id: runId, userId } });
  if (!run || (run.status !== 'queued' && run.status !== 'running')) return;
  validateDeskArtifactPaths(userId, runId);
  const directory = deskResultsDir(userId, runId);
  if (!fs.existsSync(path.join(directory, 'manifest.json')) && run.status === 'queued'
    && Date.now() - run.createdAt.getTime() < 15_000) return;
  await applySnapshot(runId, userId, await deskControl(directory, 'snapshot'));
}

export async function reapOrphanDeskRuns(userId: string): Promise<void> {
  const runs = await prisma.deskRun.findMany({ where: { userId, status: { in: ['queued', 'running'] } }, select: { id: true } });
  for (const run of runs) await finalizeDeskRun(run.id, userId);
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

function readOutFile(outPath: string): { signal?: string; finalState?: unknown } | null {
  if (!fs.existsSync(outPath)) return null;
  try {
    assertNoSymlinks(outPath);
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

/** Reject escaping IDs and symlink/junction components before filesystem side effects. */
export function validateDeskArtifactPaths(userId: string, runId = 'validation', tickers: string[] = []): void {
  for (const id of [userId, runId]) {
    if (!/^[A-Za-z0-9_-]+$/.test(id) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(id)) throw new Error('Invalid artifact owner/run');
  }
  const root = path.resolve(deskDataRoot());
  if (tickers.some(ticker => !isDeskTicker(ticker))) throw new Error('Invalid artifact ticker');
  for (const target of [deskResultsDir(userId, runId), deskMemoryLogPath(userId), deskCacheDir(userId),
    ...tickers.flatMap(ticker => [path.join(deskResultsDir(userId, runId), `out-${ticker}.json`),
      ...['', '-wal', '-shm'].map(suffix => path.join(deskCacheDir(userId), 'checkpoints', `${ticker}.db${suffix}`))]),
    ...['out.json', 'events.jsonl', 'stderr.log', 'pid', 'launch', 'manifest.json', 'state.json', 'cancel.json', 'control.lock', 'owner.lock', 'claimed', ...[0, 1, 2].flatMap(i => [`result-${i}.json`, `exit-${i}.json`])].map(name => path.join(deskResultsDir(userId, runId), name))]) {
    const relative = path.relative(root, target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Artifact path escapes Desk root');
    assertNoSymlinks(target);
  }
}

function assertNoSymlinks(target: string): void {
  const resolved = path.resolve(target);
  const root = path.parse(resolved).root;
  let current = root;
  for (const part of resolved.slice(root.length).split(path.sep)) {
    current = path.join(current, part);
    if (fs.lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('Symlink artifacts are not supported');
  }
}

function validTickerOutput(out: { finalState?: unknown }, ticker: string, asOf: string): boolean {
  const state = curateDeskState(out.finalState);
  return !!state && Object.keys(state).length > 0
    && (!state.company_of_interest || state.company_of_interest === ticker)
    && (!state.trade_date || state.trade_date === asOf);
}

/** Recover only known legacy output filenames. Never walk arbitrary report/log trees. */
export function hydrateDeskRun<T extends DeskResultRun & { id: string; userId: string }>(run: T): T {
  if (hasDeskResults(run.finalState)) return run;
  validateDeskArtifactPaths(run.userId, run.id);
  const results = deskRunResults(run);
  const root = deskResultsDir(run.userId, run.id);
  for (let index = 0; index < results.length; index += 1) {
    const ticker = results[index].ticker;
    if (!isDeskTicker(ticker)) continue;
    const archived = readOutFile(path.join(root, `out-${ticker}.json`));
    const current = run.activeTicker === ticker || run.tickers.length === 1 ? readOutFile(deskOutPath(root)) : null;
    const out = archived && validTickerOutput(archived, ticker, run.asOf) ? archived
      : current && validTickerOutput(current, ticker, run.asOf) ? current : null;
    if (!out) continue;
    const signal = parseDeskSignalText(out.signal) ?? 'REVIEW';
    results[index] = { ...results[index], signal, status: signal === 'REVIEW' ? 'review' : 'completed',
      finalState: curateDeskState(out.finalState), error: null };
  }
  return { ...run, finalState: packDeskResults(results) };
}

/** Compare-and-swap merges prevent terminal cancellation from being overwritten by an exit. */
async function updateDeskResults(
  runId: string, userId: string,
  change: (run: NonNullable<Awaited<ReturnType<typeof prisma.deskRun.findFirst>>>, results: DeskTickerResult[]) => Prisma.DeskRunUpdateManyMutationInput | null,
): Promise<boolean> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const run = await prisma.deskRun.findFirst({ where: { id: runId, userId } });
    if (!run) return false;
    const results = hasDeskResults(run.finalState) ? deskRunResults(run)
      : run.status === 'queued' ? emptyDeskResults(run.tickers) : deskRunResults(hydrateDeskRun(run));
    const data = change(run, results);
    if (!data) return false;
    const updated = await prisma.deskRun.updateMany({ where: { id: runId, userId, updatedAt: run.updatedAt, status: run.status },
      data: { ...data, updatedAt: new Date(Math.max(Date.now(), run.updatedAt.getTime() + 1)) } });
    if (updated.count) return true;
  }
  throw new Error('Desk result changed concurrently; retry the request');
}

export async function finishDeskRun(runId: string, userId: string, status: 'failed' | 'cancelled', error: string | null) {
  return updateDeskResults(runId, userId, (run, results) => {
    if (run.status !== 'queued' && run.status !== 'running') return null;
    const now = new Date();
    const active = run.activeTicker ?? run.tickers[0];
    const finished = results.map(result => isAvailableDeskResult(result) ? result : {
      ...result, status: result.ticker === active ? status : 'skipped' as const,
      error: result.ticker === active ? error : 'Not started because the run stopped', finishedAt: now.toISOString(),
    });
    return { status, signal: null, error, finishedAt: now, finalState: packDeskResults(finished) as Prisma.InputJsonValue };
  });
}
