/**
 * One-shot: copy local Docker Postgres data for adityas5609@gmail.com
 * onto the matching Supabase user (keeps cloud password/session).
 *
 * Usage (with .env pointing at Supabase):
 *   npx tsx --require dotenv/config scripts/migrate-local-to-supabase.ts
 */
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const TARGET_EMAIL = 'adityas5609@gmail.com';
const LOCAL_URL =
  process.env.LOCAL_DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/market_intel';

function loadEnvKey(key: string): string | null {
  const envPath = path.join(process.cwd(), '.env');
  const raw = fs.readFileSync(envPath, 'utf8');
  const match = raw.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`, 'm'));
  if (!match) return null;
  return match[1].trim().replace(/^["']|["']$/g, '');
}

function setEnvKey(key: string, value: string) {
  const envPath = path.join(process.cwd(), '.env');
  let raw = fs.readFileSync(envPath, 'utf8');
  const line = `${key}="${value}"`;
  const pattern = new RegExp(`^\\s*${key}\\s*=.*$`, 'm');
  if (pattern.test(raw)) {
    raw = raw.replace(pattern, line);
  } else {
    if (!raw.endsWith('\n')) raw += '\n';
    raw += `${line}\n`;
  }
  fs.writeFileSync(envPath, raw, 'utf8');
}

async function main() {
  const directUrl = loadEnvKey('DIRECT_URL') || loadEnvKey('DATABASE_URL');
  if (!directUrl) {
    throw new Error('DIRECT_URL / DATABASE_URL missing from .env (Supabase target)');
  }

  const local = new PrismaClient({
    datasources: { db: { url: LOCAL_URL } },
  });
  // Prefer session/direct URL for multi-step writes (avoids pgbouncer issues)
  const cloud = new PrismaClient({
    datasources: { db: { url: directUrl } },
  });

  try {
    const localUser = await local.user.findUnique({
      where: { email: TARGET_EMAIL },
      include: {
        watchlist: true,
        apiKeys: true,
        insightSessions: { include: { messages: true } },
      },
    });
    if (!localUser) {
      throw new Error(`Local user ${TARGET_EMAIL} not found`);
    }

    const cloudUser = await cloud.user.findUnique({ where: { email: TARGET_EMAIL } });
    if (!cloudUser) {
      throw new Error(`Cloud user ${TARGET_EMAIL} not found — sign up once on Supabase first`);
    }

    console.log(`Local  user id: ${localUser.id}`);
    console.log(`Cloud  user id: ${cloudUser.id}`);
    console.log(
      `Migrating: watchlist=${localUser.watchlist.length}, apiKeys=${localUser.apiKeys.length}, sessions=${localUser.insightSessions.length}, messages=${localUser.insightSessions.reduce((n, s) => n + s.messages.length, 0)}`,
    );

    // Promote admin + keep existing cloud credentials
    await cloud.user.update({
      where: { id: cloudUser.id },
      data: {
        role: 'admin',
        name: localUser.name ?? cloudUser.name,
        image: localUser.image ?? cloudUser.image,
      },
    });

    // Remove seed / example watchlists (john@doe + any current cloud rows for target)
    const john = await cloud.user.findUnique({ where: { email: 'john@doe.com' } });
    if (john) {
      const deletedJohn = await cloud.watchlist.deleteMany({ where: { userId: john.id } });
      console.log(`Removed john@doe.com watchlist rows: ${deletedJohn.count}`);
    }
    const cleared = await cloud.watchlist.deleteMany({ where: { userId: cloudUser.id } });
    console.log(`Cleared cloud target watchlist rows: ${cleared.count}`);

    // Watchlist
    if (localUser.watchlist.length) {
      const result = await cloud.watchlist.createMany({
        data: localUser.watchlist.map((w) => ({
          id: w.id,
          userId: cloudUser.id,
          ticker: w.ticker,
          sector: w.sector,
          createdAt: w.createdAt,
        })),
        skipDuplicates: true,
      });
      console.log(`Imported watchlist: ${result.count}`);
    }

    // API keys (BYOK / stored providers)
    for (const key of localUser.apiKeys) {
      await cloud.apiKey.upsert({
        where: {
          userId_provider: { userId: cloudUser.id, provider: key.provider },
        },
        update: {
          apiKey: key.apiKey,
          updatedAt: key.updatedAt,
        },
        create: {
          id: key.id,
          userId: cloudUser.id,
          provider: key.provider,
          apiKey: key.apiKey,
          createdAt: key.createdAt,
          updatedAt: key.updatedAt,
        },
      });
    }
    console.log(`Upserted api keys: ${localUser.apiKeys.length}`);

    // Insights sessions + messages (cloud starts empty for this user)
    await cloud.insightMessage.deleteMany({
      where: { session: { userId: cloudUser.id } },
    });
    await cloud.insightSession.deleteMany({ where: { userId: cloudUser.id } });

    for (const session of localUser.insightSessions) {
      await cloud.insightSession.create({
        data: {
          id: session.id,
          userId: cloudUser.id,
          title: session.title,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          messages: {
            create: session.messages.map((m) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              metadata: m.metadata ?? undefined,
              createdAt: m.createdAt,
            })),
          },
        },
      });
    }
    console.log(`Imported insight sessions: ${localUser.insightSessions.length}`);

    // Global YouTube summaries
    const yt = await local.youtubeVideoSummary.findMany();
    for (const row of yt) {
      await cloud.youtubeVideoSummary.upsert({
        where: { videoId: row.videoId },
        update: {
          title: row.title,
          channelHandle: row.channelHandle,
          channelId: row.channelId,
          publishedAt: row.publishedAt,
          url: row.url,
          transcriptLength: row.transcriptLength,
          summary: row.summary ?? undefined,
          rawTranscriptSnippet: row.rawTranscriptSnippet,
          stockMentions: row.stockMentions,
          processedAt: row.processedAt,
          updatedAt: row.updatedAt,
        },
        create: {
          id: row.id,
          videoId: row.videoId,
          title: row.title,
          channelHandle: row.channelHandle,
          channelId: row.channelId,
          publishedAt: row.publishedAt,
          url: row.url,
          transcriptLength: row.transcriptLength,
          summary: row.summary ?? undefined,
          rawTranscriptSnippet: row.rawTranscriptSnippet,
          stockMentions: row.stockMentions,
          processedAt: row.processedAt,
          updatedAt: row.updatedAt,
        },
      });
    }
    console.log(`Upserted YouTube summaries: ${yt.length}`);

    // Ensure ADMIN_EMAILS includes target (does not print secrets)
    const existing = loadEnvKey('ADMIN_EMAILS') ?? '';
    const emails = existing
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    if (!emails.includes(TARGET_EMAIL)) {
      emails.push(TARGET_EMAIL);
      setEnvKey('ADMIN_EMAILS', emails.join(','));
      console.log('Updated ADMIN_EMAILS to include', TARGET_EMAIL);
    } else {
      console.log('ADMIN_EMAILS already includes', TARGET_EMAIL);
    }

    // Verify
    const verify = await cloud.user.findUnique({
      where: { id: cloudUser.id },
      select: {
        email: true,
        role: true,
        _count: {
          select: {
            watchlist: true,
            apiKeys: true,
            insightSessions: true,
          },
        },
      },
    });
    const ytCount = await cloud.youtubeVideoSummary.count();
    const johnWatch = john
      ? await cloud.watchlist.count({ where: { userId: john.id } })
      : 0;

    console.log('');
    console.log('Verification:');
    console.log(`  ${verify?.email} role=${verify?.role}`);
    console.log(`  watchlist=${verify?._count.watchlist}`);
    console.log(`  apiKeys=${verify?._count.apiKeys}`);
    console.log(`  insightSessions=${verify?._count.insightSessions}`);
    console.log(`  youtubeSummaries=${ytCount}`);
    console.log(`  john@doe watchlist remaining=${johnWatch}`);
    console.log('');
    console.log('Done. Restart npm run dev if it is already running so ADMIN_EMAILS reloads.');
  } finally {
    await local.$disconnect();
    await cloud.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
