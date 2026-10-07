import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';
import { deskCursorScope, followDeskJsonl } from './stream-file';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), find: vi.fn() }));
vi.mock('@/lib/desk/access', () => ({ requireDeskAccess: mocks.auth }));
vi.mock('@/lib/prisma', () => ({ prisma: { deskRun: { findFirst: mocks.find } } }));
vi.mock('./runner', async original => ({ ...await original<typeof import('./runner')>(),
  reapOrphanDeskRuns: vi.fn(), finalizeDeskRun: vi.fn() }));
import { GET as download } from '../../app/api/desk/runs/[id]/download/route';

it('real Python tool/checkpoint output stays safe in exports; cp1252 emitter/pump bytes survive replay', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desk14-exports-'));
  const directory = path.join(root, 'user-one', 'run-one');
  const sentinel = 'desk14-fred-sentinel-NOT-A-REAL-KEY';
  const unicode = 'café 東京 信号 🚀';
  try {
    const env: NodeJS.ProcessEnv = { NODE_ENV: 'test' };
    for (const [key, value] of Object.entries(process.env)) {
      if (['PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE'].includes(key.toUpperCase())) env[key] = value;
    }
    Object.assign(env, { PYTHON_DOTENV_DISABLED: '1', PYTHONDONTWRITEBYTECODE: '1' });
    const python = path.resolve('TradingAgents/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    const result = spawnSync(python, [path.resolve('test/desk_fixture_safety.py'), 'boundaries', directory],
      { cwd: root, env, encoding: 'utf8', timeout: 60_000, windowsHide: true });
    expect(result.status, `${result.error ?? ''}\n${result.stderr}`).toBe(0);
    const payload = JSON.parse(fs.readFileSync(path.join(directory, 'out-AAPL.json'), 'utf8'));
    const evidence = fs.readFileSync(path.join(directory, 'evidence.json'), 'utf8');
    expect(evidence).not.toContain(sentinel);
    expect(evidence).toContain('503');
    expect(payload.finalState.news_report).toContain(unicode);
    const run = { id: 'run-one', userId: 'user-one', tickers: ['AAPL'], asOf: '2026-10-01',
      status: 'review', activeTicker: 'AAPL', signal: payload.signal, finalState: payload.finalState };
    vi.stubEnv('DESK_DATA_ROOT', root);
    mocks.auth.mockResolvedValue({ userId: 'user-one', key: { key: 'offline-route-sentinel' } });
    mocks.find.mockImplementation(async ({ where }) => where.id === run.id && where.userId === run.userId ? run : null);
    for (const format of ['md', 'zip']) {
      const response = await download(new NextRequest(`http://localhost/api/desk/runs/run-one/download?format=${format}`),
        { params: { id: run.id } });
      expect(response.status).toBe(200);
      // ZIP entries are stored uncompressed by the production exporter.
      const bytes = Buffer.from(await response.arrayBuffer());
      expect(bytes.includes(Buffer.from(sentinel))).toBe(false);
      expect(bytes.includes(Buffer.from(unicode))).toBe(true);
      expect(bytes.includes(Buffer.from('503'))).toBe(true);
    }
    const file = path.join(directory, 'events.jsonl');
    const scope = deskCursorScope(run.userId, run.id);
    const records = [];
    for await (const record of followDeskJsonl(file, { scope, isFinished: async () => true })) records.push(record);
    expect(records.map(r => r.data.event)).toEqual(['memo', 'error']);
    for (const { data } of records) {
      expect(data.text ?? data.message).toContain(unicode);
      expect(JSON.stringify(data)).not.toContain(sentinel);
      expect(JSON.stringify(data)).not.toContain('\ufffd');
    }
    const resumed = [];
    for await (const record of followDeskJsonl(file, { scope, after: records[0].id, isFinished: async () => true })) resumed.push(record);
    expect(resumed).toEqual(records.slice(1));
  } finally {
    vi.unstubAllEnvs();
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 75_000);
