export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import fs from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { requireDeskAccess } from '@/lib/desk/access';
import { deskResultsDir } from '@/lib/desk/config';
import { deskReportMarkdown, parseDeskReport, parseDeskSignalText, resolveDeskRating } from '@/lib/desk/report';
import { prisma } from '@/lib/prisma';

interface RouteContext {
  params: { id: string };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let crc = i;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[i] = crc >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function includeReportFile(relPosix: string): boolean {
  const base = relPosix.split('/').pop() ?? relPosix;
  if (base === 'trading_memory.md' || base === 'events.jsonl' || base === 'pid') return false;
  if (relPosix.split('/').includes('cache')) return false;
  if (relPosix === 'out.json') return true;
  if (relPosix.split('/').includes('TradingAgentsStrategy_logs')) return true;
  return relPosix.endsWith('.md');
}

function walkReportFiles(root: string): { name: string; data: Buffer }[] {
  const resolved = path.resolve(root);
  const files: { name: string; data: Buffer }[] = [];
  if (!fs.existsSync(resolved)) return files;

  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(resolved, abs);
      if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
      const relPosix = rel.split(path.sep).join('/');
      if (entry.isDirectory()) {
        if (entry.name === 'cache') continue;
        visit(abs);
        continue;
      }
      if (!includeReportFile(relPosix)) continue;
      files.push({ name: relPosix, data: fs.readFileSync(abs) });
    }
  };

  visit(resolved);
  return files;
}

function buildStoredZip(files: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const crc = crc32(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(file.data.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const localFull = Buffer.concat([local, name, file.data]);
    locals.push(localFull);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(file.data.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, name]));
    offset += localFull.length;
  }

  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralDir, eocd]);
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  const auth = await requireDeskAccess();
  if (auth instanceof NextResponse) return auth;

  const run = await prisma.deskRun.findFirst({
    where: { id: params.id, userId: auth.userId },
  });
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });

  const status = run.status === 'completed' || run.status === 'review' ? run.status : null;
  if (!status) {
    return NextResponse.json({ error: 'Report is only available after the run finishes' }, { status: 409 });
  }

  const format = req.nextUrl.searchParams.get('format') === 'zip' ? 'zip' : 'md';
  const ticker = (run.tickers[0] ?? 'desk').toUpperCase();
  const report = parseDeskReport(run.finalState, ticker);
  const rating = resolveDeskRating(parseDeskSignalText(run.signal), report, status);
  const markdown = deskReportMarkdown(report, rating);
  const slug = (report.ticker || ticker).replace(/[^A-Z0-9.-]/gi, '_');

  if (format === 'md') {
    return new NextResponse(markdown, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${slug}-desk-report.md"`,
      },
    });
  }

  const files = walkReportFiles(deskResultsDir(run.userId, run.id));
  if (files.length === 0) {
    files.push({ name: `${slug}-desk-report.md`, data: Buffer.from(markdown, 'utf8') });
  }

  const zip = buildStoredZip(files);
  return new NextResponse(new Uint8Array(zip), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${slug}-desk-report.zip"`,
    },
  });
}
