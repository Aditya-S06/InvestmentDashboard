export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/require-user';
import { getCachedCard, setCachedCard } from '@/lib/market/cache';
import { marketError } from '@/lib/market/http';
import { normalizeMarketSymbol } from '@/lib/market/symbol';
import { runPython } from '@/lib/python-runner';

const MAX_SYMBOLS = 40;

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  const requested = (req.nextUrl.searchParams.get('symbols') || '')
    .split(',')
    .map(normalizeMarketSymbol)
    .filter((symbol): symbol is string => !!symbol);
  const symbols = [...new Set(requested)].slice(0, MAX_SYMBOLS);

  if (symbols.length === 0) {
    return NextResponse.json({ error: 'At least one valid symbol is required' }, { status: 400 });
  }

  const cards: unknown[] = [];
  const misses: string[] = [];
  for (const symbol of symbols) {
    const cached = getCachedCard(symbol);
    if (cached) cards.push(cached);
    else misses.push(symbol);
  }

  if (misses.length === 0) return NextResponse.json({ cards, cached: true });

  try {
    // One Python process for every uncached symbol, not three per symbol.
    const data = await runPython(['cards', misses.join(',')]);
    const fetched: unknown[] = Array.isArray(data?.cards) ? data.cards : [];
    for (const card of fetched) {
      const symbol = (card as { symbol?: string; error?: string })?.symbol;
      if (symbol && !(card as { error?: string }).error) setCachedCard(symbol, card);
      cards.push(card);
    }
    return NextResponse.json({ cards, cached: false });
  } catch (error) {
    return marketError('cards', error);
  }
}
