import { NextResponse } from 'next/server';

export function pythonErrorMessage(data: unknown): string | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const error = (data as { error?: unknown }).error;
  if (typeof error === 'string' && error.trim()) return error.trim();
  return null;
}

export function brokerPythonError(
  data: unknown,
  extra: Record<string, unknown> = {},
): NextResponse | null {
  const error = pythonErrorMessage(data);
  if (!error) return null;
  return NextResponse.json({ error, ...extra }, { status: 502 });
}
