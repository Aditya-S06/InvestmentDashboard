import 'server-only';

import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/require-user';
import * as shared from '@/lib/http/json';

export class PaperApiError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = 'PaperApiError';
  }
}

const fail = (message: string) => new PaperApiError(message);

export async function requirePaperUser(): Promise<string | NextResponse> {
  const auth = await requireUser();
  return auth instanceof NextResponse ? auth : auth.userId;
}

export function readJsonObject(request: Request) {
  return shared.readJsonObject(request, fail);
}

export const paperJson = shared.jsonResponse;

export function paperError(error: unknown): NextResponse {
  if (error instanceof PaperApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  const conflict = shared.uniqueConstraintResponse(error);
  if (conflict) return conflict;

  const message = error instanceof Error ? error.message : 'Paper portfolio request failed';
  const validationMessage =
    /must|required|cannot|exceed|invalid|only|missing|below|above|position|risk|equity|cash|USD-listed/i.test(message);
  return NextResponse.json(
    { error: validationMessage ? message : 'Paper portfolio request failed' },
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
