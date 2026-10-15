// Exercises a separately built production server on loopback; never signs in or places an order.
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const origin = 'http://127.0.0.1:3101';
const server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', '3101'], {
  env: { ...process.env, NEXT_DIST_DIR: '.next/security-check', NEXTAUTH_URL: origin, ALLOW_PUBLIC_SIGNUP: 'false', CSP_ENFORCE: 'false' },
  stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
});
let ready = false;
server.stdout.on('data', chunk => { if (chunk.toString().includes('Ready')) ready = true; });
server.stderr.on('data', () => {}); // Never print server diagnostics that may contain deployment values.
const exited = new Promise(resolve => server.on('exit', resolve));
async function main() {
  for (let i = 0; i < 100 && !ready; i++) {
    if (server.exitCode !== null) throw new Error('Temporary server exited');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert(ready, 'Temporary server did not start');
  const login = await fetch(`${origin}/login`);
  assert.equal(login.status, 200);
  const csp = login.headers.get('content-security-policy-report-only');
  const nonce = /'nonce-([^']+)'/.exec(csp || '')?.[1];
  assert(nonce, 'CSP nonce missing');
  const html = await login.text();
  const scripts = html.match(/<script\b[^>]*>/g) || [];
  assert(scripts.length > 0);
  assert(scripts.every(script => script.includes(`nonce="${nonce}"`)), 'Script missing matching nonce');
  const nextLogin = await fetch(`${origin}/login`);
  assert.notEqual(nextLogin.headers.get('content-security-policy-report-only'), csp);
  const dashboard = await fetch(`${origin}/dashboard`, { redirect: 'manual' });
  assert.equal(dashboard.status, 307);
  assert(dashboard.headers.get('location')?.includes('/login'));
  const tokenResponse = await fetch(`${origin}/api/auth/csrf`);
  const { csrfToken } = await tokenResponse.json();
  const cookie = tokenResponse.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const headers = { origin, cookie, 'x-csrf-token': csrfToken, 'content-type': 'application/json' };
  const valid = await fetch(`${origin}/api/settings/apikeys`, { method: 'POST', headers, body: '{}' });
  assert.equal(valid.status, 401, 'Valid CSRF should reach the unauthenticated session gate');
  const forged = await fetch(`${origin}/api/settings/apikeys`, { method: 'POST', headers: { ...headers, origin: 'https://attacker.test' }, body: '{}' });
  assert.equal(forged.status, 403);
  const missing = await fetch(`${origin}/api/watchlist`, { method: 'DELETE', headers: { origin } });
  assert.equal(missing.status, 403);
  console.log(JSON.stringify({ productionLogin: true, allScriptsNonced: scripts.length, uniqueNonces: true, dashboardAuthRedirect: true, nextAuthIssuedCsrfAccepted: true, forgedOriginDenied: true, missingTokenDenied: true }));
}
main().catch(error => { console.error('HTTP smoke failed:', error.message); process.exitCode = 1; })
  .finally(async () => { server.kill(); await exited; });
