import 'server-only';

export function isWebullConfigured(): boolean {
  return Boolean(process.env.WEBULL_APP_KEY?.trim() && process.env.WEBULL_APP_SECRET?.trim());
}

export function getWebullEnvironment(): string {
  return (process.env.WEBULL_ENVIRONMENT || 'prod').trim().toLowerCase();
}

export function requireWebullConfig(): { ok: true } | { ok: false; error: string } {
  if (!isWebullConfigured()) {
    return { ok: false, error: 'Webull is not configured. Set WEBULL_APP_KEY and WEBULL_APP_SECRET in .env.' };
  }
  return { ok: true };
}
