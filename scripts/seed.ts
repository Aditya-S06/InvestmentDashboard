import { createPrismaClient } from '../lib/database/client';
import bcrypt from 'bcryptjs';
import { upsertDefaultWatchlist } from '../lib/seed-watchlist';

const prisma = createPrismaClient();

async function main() {
  if ((process.env.SEED_DEMO_USER || '').trim().toLowerCase() !== 'true') {
    console.log('Demo seed disabled — set SEED_DEMO_USER=true explicitly for local development');
    return;
  }

  const hashedPassword = await bcrypt.hash('johndoe123', 12);

  const user = await prisma.user.upsert({
    where: { email: 'john@doe.com' },
    update: {},
    create: {
      email: 'john@doe.com',
      name: 'John Doe',
      password: hashedPassword,
    },
  });

  const count = await upsertDefaultWatchlist(user.id, prisma);
  console.log(`Seeded ${count} starter watchlist tickers for john@doe.com`);
  console.log('Delete this demo account before exposing the app beyond localhost.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
