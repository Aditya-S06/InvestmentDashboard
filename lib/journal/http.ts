import 'server-only';

import type { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/require-user';
import * as shared from '@/lib/http/json';

export class JournalApiError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = 'JournalApiError';
  }
}

const fail = (message: string) => new JournalApiError(message);

export async function requireJournalUser(): Promise<string | NextResponse> {
  const auth = await requireUser();
  return auth instanceof NextResponse ? auth : auth.userId;
}

export function readJsonObject(request: Request) {
  return shared.readJsonObject(request, fail);
}

export const journalJson = shared.jsonResponse;

export function journalError(error: unknown): NextResponse {
  if (error instanceof JournalApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  const conflict = shared.uniqueConstraintResponse(error);
  if (conflict) return conflict;

  const message = error instanceof Error ? error.message : 'Journal request failed';
  const validationMessage = /must|required|cannot|exceed|invalid|only|missing|below|above/i.test(message);
  return NextResponse.json(
    { error: validationMessage ? message : 'Journal request failed' },
    { status: validationMessage ? 400 : 500 },
  );
}

export function optionalString(value: unknown, field: string, maxLength = 20_000) {
  return shared.optionalString(value, field, fail, maxLength);
}

export function requiredString(value: unknown, field: string, maxLength = 20_000) {
  return shared.requiredString(value, field, fail, maxLength);
}

export function stringArray(value: unknown, field: string) {
  return shared.stringArray(value, field, fail);
}

export function optionalDate(value: unknown, field: string) {
  return shared.optionalDate(value, field, fail);
}

export function requiredDate(value: unknown, field: string) {
  return shared.requiredDate(value, field, fail);
}

export function requiredDecimal(value: unknown, field: string): Prisma.Decimal {
  return shared.requiredDecimal(value, field, fail);
}

export function optionalDecimal(value: unknown, field: string): Prisma.Decimal | undefined {
  return shared.optionalDecimal(value, field, fail);
}

export function normalizeUsEquitySymbol(raw: unknown): string {
  const symbol = requiredString(raw, 'symbol', 10).toUpperCase();
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) {
    throw new JournalApiError('symbol must be a valid ticker');
  }
  return symbol;
}
