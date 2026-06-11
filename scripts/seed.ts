import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { upsertDefaultWatchlist } from '../lib/seed-watchlist';

const prisma = new PrismaClient();

async function main() {
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

  const count = await upsertDefaultWatchlist(user.id);
  console.log(`Seeded ${count} starter watchlist tickers for john@doe.com`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
