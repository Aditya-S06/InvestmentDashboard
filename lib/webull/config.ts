import 'server-only';

function truthy(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes((value || '').trim().toLowerCase());
}

export type WebullEnvName = 'sandbox' | 'prod';

export function getWebullEnvironment(): WebullEnvName {
  const env = (process.env.WEBULL_ENVIRONMENT || 'sandbox').trim().toLowerCase();
  if (env === 'prod' || env === 'production' || env === 'live') return 'prod';
  return 'sandbox';
}

export function isSandboxEnvironment(): boolean {
  return getWebullEnvironment() === 'sandbox';
}

export function isWebullConfigured(): boolean {
  const sandbox = isSandboxEnvironment();
  const key = sandbox
    ? process.env.WEBULL_APP_KEY_SANDBOX || process.env.WEBULL_APP_KEY
    : process.env.WEBULL_APP_KEY_PROD || process.env.WEBULL_APP_KEY;
  const secret = sandbox
    ? process.env.WEBULL_APP_SECRET_SANDBOX || process.env.WEBULL_APP_SECRET
    : process.env.WEBULL_APP_SECRET_PROD || process.env.WEBULL_APP_SECRET;
  return Boolean(key?.trim() && secret?.trim());
}

export function requireWebullConfig(): { ok: true } | { ok: false; error: string } {
  if (!isWebullConfigured()) {
    return { ok: false, error: 'Webull is not configured. Set WEBULL_APP_KEY and WEBULL_APP_SECRET in .env.' };
  }
  return { ok: true };
}

export function isTradingEnabled(): boolean {
  return truthy(process.env.WEBULL_TRADING_ENABLED);
}

export function isLiveTradingEnabled(): boolean {
  return truthy(process.env.WEBULL_LIVE_TRADING_ENABLED);
}

export function getMaxNotionalUsd(): number {
  const n = Number(process.env.WEBULL_MAX_NOTIONAL_USD || '5000');
  return Number.isFinite(n) && n > 0 ? n : 5000;
}

export function getMaxQty(): number {
  const n = Number(process.env.WEBULL_MAX_QTY || '100');
  return Number.isFinite(n) && n > 0 ? n : 100;
}

export type TradingGate =
  | { ok: true; environment: WebullEnvName }
  | { ok: false; error: string; code: string; status: number };

export function assertTradingAllowed(killSwitch = false): TradingGate {
  if (!isWebullConfigured()) {
    return { ok: false, error: 'Webull is not configured', code: 'not_configured', status: 503 };
  }
  if (killSwitch) {
    return { ok: false, error: 'Trading kill switch is on', code: 'trading_disabled', status: 403 };
  }
  if (!isTradingEnabled()) {
    return { ok: false, error: 'Trading disabled', code: 'trading_disabled', status: 403 };
  }
  if (!isSandboxEnvironment() && !isLiveTradingEnabled()) {
    return { ok: false, error: 'Live trading is locked', code: 'live_trading_disabled', status: 403 };
  }
  return { ok: true, environment: getWebullEnvironment() };
}

/**
 * Gate for risk-reducing actions (cancel, reduce-only replace). Deliberately
 * ignores the kill switch and the trading flags so an operator can always
 * flatten working orders during an incident.
 */
export function assertRiskReducingAllowed(): TradingGate {
  if (!isWebullConfigured()) {
    return { ok: false, error: 'Webull is not configured', code: 'not_configured', status: 503 };
  }
  return { ok: true, environment: getWebullEnvironment() };
}
