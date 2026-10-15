import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiFetch } from './api-fetch';

beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => vi.unstubAllGlobals());
it('obtains a token and preserves mutation body, headers and abort signal', async () => {
  const token = 'a'.repeat(64);
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ csrfToken: token })).mockResolvedValueOnce(Response.json({ ok: true }));
  const signal = new AbortController().signal;
  const body = JSON.stringify({ quantity: 1 });
  await apiFetch('/api/broker/orders/place', { method: 'POST', body, signal, headers: { 'content-type': 'application/json' } });
  expect(fetch).toHaveBeenCalledTimes(2);
  const [, init] = vi.mocked(fetch).mock.calls[1];
  expect(new Headers(init?.headers).get('x-csrf-token')).toBe(token);
  expect(init).toMatchObject({ body, signal, credentials: 'same-origin' });
});
it('does not send a mutation if token issuance fails', async () => {
  vi.mocked(fetch).mockResolvedValue(Response.json({ error: 'offline' }, { status: 503 }));
  await expect(apiFetch('/api/watchlist', { method: 'DELETE' })).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('never retries a rejected order', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ csrfToken: 'a'.repeat(64) })).mockResolvedValueOnce(new Response(null, { status: 403 }));
  expect((await apiFetch('/api/broker/orders/place', { method: 'POST' })).status).toBe(403);
  expect(fetch).toHaveBeenCalledTimes(2);
});
it('passes reads through and refuses to send tokens to external targets', async () => {
  vi.mocked(fetch).mockResolvedValue(Response.json({}));
  await apiFetch('/api/watchlist');
  expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/watchlist', {});
  await expect(apiFetch('https://attacker.test/api/', { method: 'POST' })).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
});
