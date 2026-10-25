import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ headers: vi.fn() }));
vi.mock('next/headers', () => ({ headers: mocks.headers }));
import { requestIp } from './http';

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

it('awaits async request headers and uses the first forwarded address', async () => {
  mocks.headers.mockResolvedValue(new Headers({ 'x-forwarded-for': '192.0.2.1, 192.0.2.2' }));
  expect(await requestIp()).toBe('192.0.2.1');
});

it('retains the real-address fallback', async () => {
  mocks.headers.mockResolvedValue(new Headers({ 'x-real-ip': '192.0.2.3' }));
  expect(await requestIp()).toBe('192.0.2.3');
});

it('does not invent an address when neither header exists', async () => {
  mocks.headers.mockResolvedValue(new Headers());
  expect(await requestIp()).toBeNull();
});
