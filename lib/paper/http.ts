import 'server-only';

import { Prisma } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth';

export class PaperApiError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = 'PaperApiError';
  }
}

export async function requirePaperUser(): Promise<string | NextResponse> {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return userId;
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch {
    throw new PaperApiError('A valid JSON object is required');
  }
}

function jsonSafe(value: unknown): unknown {
  if (value instanceof Prisma.Decimal) return value.toFixed();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  }
  return value;
}

export function paperJson(data: unknown, init?: ResponseInit | number): NextResponse {
  const responseInit = typeof init === 'number' ? { status: init } : init;
  return NextResponse.json(jsonSafe(data), responseInit);
}

export function paperError(error: unknown): NextResponse {
  if (error instanceof PaperApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return NextResponse.json({ error: 'That record already exists' }, { status: 409 });
  }
  const message = error instanceof Error ? error.message : 'Paper portfolio request failed';
  const validationMessage =
    /must|required|cannot|exceed|invalid|only|missing|below|above|position|risk|equity|cash|USD-listed/i.test(message);
  return NextResponse.json(
    { error: validationMessage ? message : 'Paper portfolio request failed' },
    { status: validationMessage ? 400 : 500 },
  );
}

export function optionalString(value: unknown, field: string, maxLength = 20_000): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'string') throw new PaperApiError(`${field} must be a string`);
  const result = value.trim();
  if (result.length > maxLength) throw new PaperApiError(`${field} is too long`);
  return result;
}

export function requiredString(value: unknown, field: string, maxLength = 20_000): string {
  const result = optionalString(value, field, maxLength);
  if (!result) throw new PaperApiError(`${field} is required`);
  return result;
}

export function stringArray(value: unknown, field: string): string[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new PaperApiError(`${field} must be an array of strings`);
  }
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))].slice(0, 50);
}

export function optionalDate(value: unknown, field: string): Date | undefined {
  if (value == null || value === '') return undefined;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new PaperApiError(`${field} must be a valid date`);
  return date;
}
