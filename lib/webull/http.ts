import 'server-only';

import { headers } from 'next/headers';

export function requestIp(): string | null {
  const h = headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || null;
}
