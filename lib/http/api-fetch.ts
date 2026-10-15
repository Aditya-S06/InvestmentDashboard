'use client';

// Share only an in-flight token read, never cache a token across login/logout or cookie changes.
let csrfRequest: Promise<string> | undefined;
async function csrfToken(): Promise<string> {
  if (!csrfRequest) {
    csrfRequest = fetch('/api/auth/csrf', { credentials: 'same-origin', cache: 'no-store' })
      .then(async response => {
        const body = response.ok ? await response.json() : null;
        if (typeof body?.csrfToken !== 'string' || !/^[a-f0-9]{64}$/.test(body.csrfToken)) {
          throw new Error('Could not prepare a secure request. Reload and try again.');
        }
        return body.csrfToken as string;
      }).finally(() => { csrfRequest = undefined; });
  }
  return csrfRequest;
}

/** Browser API requests only. Never retry a mutation, especially broker orders. */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method || 'GET').toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return fetch(input, init);
  if (!input.startsWith('/api/') || input.startsWith('/api/auth/')) throw new Error('Unsupported mutation target');
  const headers = new Headers(init.headers);
  headers.set('x-csrf-token', await csrfToken());
  return fetch(input, { ...init, headers, credentials: 'same-origin' });
}
