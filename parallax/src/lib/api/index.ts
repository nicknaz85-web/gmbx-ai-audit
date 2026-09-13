import type { DataProvider } from "./provider";
import { mockProvider } from "./mock/mockProvider";

/* Provider selection + a light server-side cache.
   DATA_PROVIDER chooses the implementation. Only the mock is shipped in Phase 1;
   real providers implement the same DataProvider interface and are registered
   here. Nothing else in the app imports a concrete provider. */

function selectProvider(): DataProvider {
  const which = (process.env.DATA_PROVIDER || "mock").toLowerCase();
  switch (which) {
    // case "finnhub": return finnhubProvider;   // Phase 2 — implement DataProvider
    // case "fmp":     return fmpProvider;
    // case "polygon": return polygonProvider;
    case "mock":
    default:
      return mockProvider;
  }
}

export const provider: DataProvider = selectProvider();

/* --------------------------------------------------------------------------
   Minimal TTL cache. Real providers should cache slow-moving data (profiles,
   statements, earnings) far longer than quotes. Keyed by call signature.
   -------------------------------------------------------------------------- */
type Entry = { value: unknown; expires: number };
const store = new Map<string, Entry>();

export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expires > now) return hit.value as T;
  const value = await fn();
  store.set(key, { value, expires: now + ttlMs });
  return value;
}

export const TTL = {
  quote: 10_000,
  candles: 60_000,
  movers: 30_000,
  news: 120_000,
  profile: 24 * 3600_000,
  statements: 6 * 3600_000,
  earnings: 3600_000,
  analyst: 3600_000,
};
