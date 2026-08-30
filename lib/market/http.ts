import 'server-only';

import { NextResponse } from 'next/server';
import { logServerError } from '@/lib/http/errors';

/**
 * Market data comes from a Python child process; its stderr can contain paths
 * and upstream detail, so callers get a generic message and the server logs it.
 */
export function marketError(scope: string, error: unknown): NextResponse {
  logServerError(`market/${scope}`, error);
  return NextResponse.json({ error: 'Market data is temporarily unavailable' }, { status: 502 });
}

export function invalidSymbol(): NextResponse {
  return NextResponse.json({ error: 'A valid ticker symbol is required' }, { status: 400 });
}
