import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ adapter: vi.fn(), client: vi.fn() }));
vi.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {
  constructor(options: unknown) { mocks.adapter(options); }
} }));
vi.mock('@prisma/client', () => ({ PrismaClient: class {
  constructor(options: unknown) { mocks.client(options); }
} }));
import { createPrismaClient } from './client';

beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('DATABASE_URL', undefined); });
afterEach(() => vi.unstubAllEnvs());

describe('Prisma driver adapter migration', () => {
  it('fails closed without a connection URL', () => {
    expect(() => createPrismaClient()).toThrow('Database connection URL is required');
    expect(mocks.adapter).not.toHaveBeenCalled();
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it('uses the runtime URL only for the default client', () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://runtime@127.0.0.1:1/sentinel');
    createPrismaClient();
    expect(mocks.adapter).toHaveBeenCalledWith({
      connectionString: 'postgresql://runtime@127.0.0.1:1/sentinel', connectionTimeoutMillis: 5000,
    });
    expect(mocks.client).toHaveBeenCalledWith({ adapter: expect.any(Object) });
  });
  it('keeps explicit identity and operator URLs separate from the runtime URL', () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://runtime@127.0.0.1:1/sentinel');
    createPrismaClient('postgresql://identity@127.0.0.1:1/sentinel');
    createPrismaClient('postgresql://operator@127.0.0.1:1/sentinel');
    expect(mocks.adapter.mock.calls.map(([options]) => options.connectionString)).toEqual([
      'postgresql://identity@127.0.0.1:1/sentinel', 'postgresql://operator@127.0.0.1:1/sentinel',
    ]);
  });
});
