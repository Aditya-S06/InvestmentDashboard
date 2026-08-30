import 'server-only';

/**
 * Single-process TTL cache for card payloads. A solo desk reloads the same
 * handful of symbols constantly, and each miss costs a Python process.
 */
const TTL_MS = 20_000;

type Entry = { value: unknown; expiresAt: number };

const store = new Map<string, Entry>();

export function getCachedCard(symbol: string): unknown | null {
  const entry = store.get(symbol);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    store.delete(symbol);
    return null;
  }
  return entry.value;
}

export function setCachedCard(symbol: string, value: unknown) {
  store.set(symbol, { value, expiresAt: Date.now() + TTL_MS });
}
