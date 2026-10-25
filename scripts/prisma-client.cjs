const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

function createPrismaClient(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('Database connection URL is required');
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString, connectionTimeoutMillis: 5000 }),
  });
}

module.exports = { createPrismaClient };
