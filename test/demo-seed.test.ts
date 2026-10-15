import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ upsert: vi.fn(), disconnect: vi.fn(), watchlist: vi.fn(), hash: vi.fn() }));
vi.mock('@prisma/client', () => ({ PrismaClient: class {
  user = { upsert: mocks.upsert };
  $disconnect = mocks.disconnect;
} }));
vi.mock('bcryptjs', () => ({ default: { hash: mocks.hash } }));
vi.mock('../lib/seed-watchlist', () => ({ upsertDefaultWatchlist: mocks.watchlist }));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  mocks.hash.mockResolvedValue('hashed-password');
  mocks.upsert.mockResolvedValue({ id: 'demo' });
  mocks.watchlist.mockResolvedValue(3);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('demo seed opt-in', () => {
  it.each([undefined, '', 'false', 'yes'])('skips all creation for %s', async value => {
    vi.stubEnv('SEED_DEMO_USER', value);
    await import('../scripts/seed');
    await vi.waitFor(() => expect(mocks.disconnect).toHaveBeenCalled());
    expect(mocks.hash).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.watchlist).not.toHaveBeenCalled();
  });
  it('allows explicit local opt-in', async () => {
    vi.stubEnv('SEED_DEMO_USER', 'true');
    await import('../scripts/seed');
    await vi.waitFor(() => expect(mocks.disconnect).toHaveBeenCalled());
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { email: 'john@doe.com' } }));
    expect(mocks.watchlist).toHaveBeenCalledWith('demo', expect.objectContaining({ user: expect.any(Object) }));
  });
});
