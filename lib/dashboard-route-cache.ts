type JsonRecord = Record<string, unknown>;

type CacheEntry = {
  at: number;
  expiresAt: number;
  status: number;
  payload: JsonRecord;
};

const GLOBAL_CACHE_KEY = '__pcu_dashboard_route_cache_v1__';
const MAX_ENTRIES = 800;

function getCacheStore(): Map<string, CacheEntry> {
  const globalRef = globalThis as typeof globalThis & {
    [GLOBAL_CACHE_KEY]?: Map<string, CacheEntry>;
  };
  if (!globalRef[GLOBAL_CACHE_KEY]) {
    globalRef[GLOBAL_CACHE_KEY] = new Map<string, CacheEntry>();
  }
  return globalRef[GLOBAL_CACHE_KEY]!;
}

function pruneOldestEntries(store: Map<string, CacheEntry>, maxEntries: number) {
  if (store.size <= maxEntries) return;
  const items = Array.from(store.entries()).sort((a, b) => a[1].at - b[1].at);
  const removeCount = Math.max(1, store.size - maxEntries);
  for (let idx = 0; idx < removeCount; idx += 1) {
    store.delete(items[idx][0]);
  }
}

export async function fetchDashboardJsonWithCache(options: {
  cacheKey: string;
  ttlMs: number;
  fetcher: () => Promise<Response>;
}): Promise<{ status: number; payload: JsonRecord; cached: boolean }> {
  const store = getCacheStore();
  const now = Date.now();
  const hit = store.get(options.cacheKey);
  if (hit && hit.expiresAt > now) {
    return { status: hit.status, payload: hit.payload, cached: true };
  }

  const response = await options.fetcher();
  const payload = (await response.json().catch(() => ({}))) as JsonRecord;

  if (response.status < 500) {
    store.set(options.cacheKey, {
      at: now,
      expiresAt: now + Math.max(250, options.ttlMs),
      status: response.status,
      payload,
    });
    pruneOldestEntries(store, MAX_ENTRIES);
  }

  return { status: response.status, payload, cached: false };
}

