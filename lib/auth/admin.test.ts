import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const user = vi.hoisted(() => ({ update: vi.fn(), findUnique: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { user } }));
import { getAdminEmails, isInsightsAdmin, syncAdminRole } from './admin';

beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('ADMIN_EMAILS', ''); });
afterEach(() => vi.unstubAllEnvs());

describe('shared admin contract', () => {
  it('normalizes configured addresses and ignores stale stored roles', () => {
    vi.stubEnv('ADMIN_EMAILS', ' Alice@Example.test, , BOB@example.test ');
    expect(getAdminEmails()).toEqual(['alice@example.test', 'bob@example.test']);
    expect(isInsightsAdmin(' ALICE@example.test ', 'user')).toBe(true);
    expect(isInsightsAdmin(null, 'admin')).toBe(false);
    expect(isInsightsAdmin('other@example.test', 'admin')).toBe(false);
    expect(isInsightsAdmin('other@example.test', 'user')).toBe(false);
  });
  it('promotes a listed user using the authenticated id', async () => {
    vi.stubEnv('ADMIN_EMAILS', 'admin@example.test');
    user.update.mockResolvedValue({ role: 'admin' });
    expect(await syncAdminRole('user-sentinel', ' ADMIN@example.test ')).toBe('admin');
    expect(user.update).toHaveBeenCalledWith({ where: { id: 'user-sentinel' }, data: { role: 'admin' }, select: { role: true } });
    expect(user.findUnique).not.toHaveBeenCalled();
  });
  it('demotes a removed admin with a nonempty configured list', async () => {
    vi.stubEnv('ADMIN_EMAILS', 'another@example.test');
    user.findUnique.mockResolvedValue({ role: 'admin' });
    user.update.mockResolvedValue({ role: 'user' });
    expect(await syncAdminRole('user-sentinel', 'removed@example.test')).toBe('user');
    expect(user.update).toHaveBeenCalledWith({ where: { id: 'user-sentinel' }, data: { role: 'user' }, select: { role: true } });
  });
  it('demotes stored admin when the configured list is empty', async () => {
    user.findUnique.mockResolvedValue({ role: 'admin' });
    user.update.mockResolvedValue({ role: 'user' });
    expect(isInsightsAdmin('removed@example.test', 'admin')).toBe(false);
    expect(await syncAdminRole('user-sentinel', 'removed@example.test')).toBe('user');
    expect(user.update).toHaveBeenCalledWith({ where: { id: 'user-sentinel' }, data: { role: 'user' }, select: { role: true } });
  });
  it('denies admin access when the allowlist is missing', () => {
    vi.stubEnv('ADMIN_EMAILS', undefined);
    expect(isInsightsAdmin('former@example.test', 'admin')).toBe(false);
  });
  it('preserves nonadmin/missing user results and propagates database failures', async () => {
    user.findUnique.mockResolvedValueOnce({ role: 'user' }).mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('offline sentinel'));
    expect(await syncAdminRole('user-sentinel')).toBe('user');
    expect(await syncAdminRole('missing-sentinel')).toBeNull();
    await expect(syncAdminRole('error-sentinel')).rejects.toThrow('offline sentinel');
    expect(user.update).not.toHaveBeenCalled();
  });
});
