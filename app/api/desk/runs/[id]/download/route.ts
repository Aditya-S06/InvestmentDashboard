export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { requireDeskAccess } from '@/lib/desk/access';
import { finalizeDeskRun, hydrateDeskRun } from '@/lib/desk/runner';
import { redactDeskSecrets } from '@/lib/desk/redact';
import { deskReportMarkdown, deskRunResults, isAvailableDeskResult, reportForDeskResult, selectDeskResult } from '@/lib/desk/report';
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

function buildStoredZip(files: { name: string; data: Buffer }[]): ReadableStream<Uint8Array> {
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

    locals.push(local, name, file.data);

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
    centrals.push(central, name);
    offset += local.length + name.length + file.data.length;
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  const parts: (Buffer | undefined)[] = [...locals, ...centrals, eocd];
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index === parts.length) { controller.close(); return; }
      const part = parts[index]!;
      parts[index++] = undefined;
      controller.enqueue(part);
    },
    cancel() { parts.length = 0; },
  }, { highWaterMark: 0 });
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  const auth = await requireDeskAccess();
  if (auth instanceof NextResponse) return auth;

  await finalizeDeskRun(params.id, auth.userId);
  const run = await prisma.deskRun.findFirst({
    where: { id: params.id, userId: auth.userId },
  });
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });

  const hydrated = hydrateDeskRun(run);
  const requested = req.nextUrl.searchParams.get('ticker');
  const selected = selectDeskResult(hydrated, requested);
  if (!selected) return NextResponse.json({ error: 'Ticker not found' }, { status: 404 });
  const format = req.nextUrl.searchParams.get('format') === 'zip' ? 'zip' : 'md';
  const available = deskRunResults(hydrated).filter(isAvailableDeskResult);
  if ((format === 'md' && !isAvailableDeskResult(selected)) || available.length === 0) {
    return NextResponse.json({ error: 'Ticker report is not available' }, { status: 409 });
  }
  const scrub = (text: string) => redactDeskSecrets(text, [auth.key.key]);
  const slug = selected.ticker.replace(/[^A-Z0-9.-]/gi, '_');
  if (format === 'md') {
    const { report, rating } = reportForDeskResult(selected, run.asOf);
    return new NextResponse(scrub(deskReportMarkdown(report, rating)), { headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${slug}-desk-report.md"`,
    } });
  }
  // Generate an allowlisted archive from curated results; no directory traversal,
  // raw logs, memory, credentials, control files or checkpoint sidecars.
  const files = available.flatMap(result => {
    const { report, rating } = reportForDeskResult(result, run.asOf);
    return [
      { name: `${result.ticker}-desk-report.md`, data: Buffer.from(scrub(deskReportMarkdown(report, rating))) },
      { name: `out-${result.ticker}.json`, data: Buffer.from(scrub(JSON.stringify({
        ticker: result.ticker, status: result.status, signal: rating, finalState: result.finalState,
        startedAt: result.startedAt, finishedAt: result.finishedAt,
      }, null, 2))) },
    ];
  });
  return new NextResponse(buildStoredZip(files), { headers: {
    'Content-Type': 'application/zip',
    'Content-Disposition': 'attachment; filename="desk-reports.zip"',
  } });
}
