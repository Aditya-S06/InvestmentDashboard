import 'server-only';

import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';

/** Domain modules pass their own error class so messages keep their status codes. */
export type ApiErrorFactory = (message: string) => Error;

export function jsonSafe(value: unknown): unknown {
  if (value instanceof Prisma.Decimal) return value.toFixed();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  }
  return value;
}

export function jsonResponse(data: unknown, init?: ResponseInit | number): NextResponse {
  const responseInit = typeof init === 'number' ? { status: init } : init;
  return NextResponse.json(jsonSafe(data), responseInit);
}

export async function readJsonObject(
  request: Request,
  fail: ApiErrorFactory,
): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch {
    throw fail('A valid JSON object is required');
  }
}

export function optionalString(
  value: unknown,
  field: string,
  fail: ApiErrorFactory,
  maxLength = 20_000,
): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'string') throw fail(`${field} must be a string`);
  const result = value.trim();
  if (result.length > maxLength) throw fail(`${field} is too long`);
  return result;
}

export function requiredString(
  value: unknown,
  field: string,
  fail: ApiErrorFactory,
  maxLength = 20_000,
): string {
  const result = optionalString(value, field, fail, maxLength);
  if (!result) throw fail(`${field} is required`);
  return result;
}

export function stringArray(value: unknown, field: string, fail: ApiErrorFactory): string[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw fail(`${field} must be an array of strings`);
  }
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))].slice(0, 50);
}

export function optionalDate(value: unknown, field: string, fail: ApiErrorFactory): Date | undefined {
  if (value == null || value === '') return undefined;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw fail(`${field} must be a valid date`);
  return date;
}

export function requiredDate(value: unknown, field: string, fail: ApiErrorFactory): Date {
  const date = optionalDate(value, field, fail);
  if (!date) throw fail(`${field} is required`);
  return date;
}

export function optionalDecimal(
  value: unknown,
  field: string,
  fail: ApiErrorFactory,
): Prisma.Decimal | undefined {
  if (value == null || value === '') return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) throw fail(`${field} must be a number`);
  return new Prisma.Decimal(number);
}

export function requiredDecimal(value: unknown, field: string, fail: ApiErrorFactory): Prisma.Decimal {
  if (value == null || value === '') throw fail(`${field} is required`);
  return optionalDecimal(value, field, fail)!;
}

/** Shared duplicate-key mapping; returns null when the error is something else. */
export function uniqueConstraintResponse(error: unknown): NextResponse | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return NextResponse.json({ error: 'That record already exists' }, { status: 409 });
  }
  return null;
}
