import 'server-only';

import { NextResponse } from 'next/server';

export function logServerError(scope: string, error: unknown) {
  console.error(`[${scope}]`, error instanceof Error ? error.message : error);
}

/**
 * Prisma and Python errors carry connection strings, file paths, and upstream
 * payloads, so responses stay generic and the detail goes to the server log.
 */
export function serverError(scope: string, error: unknown, message = 'Something went wrong'): NextResponse {
  logServerError(scope, error);
  return NextResponse.json({ error: message }, { status: 500 });
}
