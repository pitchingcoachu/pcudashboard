type JsonRecord = Record<string, unknown>;

type CacheEntry = {
  at: number;
  expiresAt: number;
  status: number;
  payload: JsonRecord;
};

const GLOBAL_CACHE_KEY = '__pcu_dashboard_route_cache_v1__';
const GLOBAL_INFLIGHT_KEY = '__pcu_dashboard_route_cache_inflight_v1__';
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

function getInflightStore(): Map<string, Promise<{ status: number; payload: JsonRecord; cached: boolean }>> {
  const globalRef = globalThis as typeof globalThis & {
    [GLOBAL_INFLIGHT_KEY]?: Map<string, Promise<{ status: number; payload: JsonRecord; cached: boolean }>>;
  };
  if (!globalRef[GLOBAL_INFLIGHT_KEY]) {
    globalRef[GLOBAL_INFLIGHT_KEY] = new Map<string, Promise<{ status: number; payload: JsonRecord; cached: boolean }>>();
  }
  return globalRef[GLOBAL_INFLIGHT_KEY]!;
}

function cloneJsonRecord<T extends JsonRecord>(value: T): T {
  try {
    if (typeof structuredClone === 'function') {
      return structuredClone(value);
    }
  } catch {
    // Fallback below.
  }
  return JSON.parse(JSON.stringify(value)) as T;
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
  const inflight = getInflightStore();
  const now = Date.now();
  const hit = store.get(options.cacheKey);
  if (hit && hit.expiresAt > now) {
    return { status: hit.status, payload: cloneJsonRecord(hit.payload), cached: true };
  }

  const inflightHit = inflight.get(options.cacheKey);
  if (inflightHit) {
    const shared = await inflightHit;
    return { status: shared.status, payload: cloneJsonRecord(shared.payload), cached: shared.cached };
  }

  const inFlightPromise = (async () => {
    try {
      const response = await options.fetcher();
      const rawPayload = (await response.json().catch(() => ({}))) as JsonRecord;
      const payload = cloneJsonRecord(rawPayload);
      if (response.status < 500) {
        store.set(options.cacheKey, {
          at: now,
          expiresAt: now + Math.max(250, options.ttlMs),
          status: response.status,
          payload: cloneJsonRecord(payload),
        });
        pruneOldestEntries(store, MAX_ENTRIES);
        return { status: response.status, payload, cached: false };
      }
      if (hit) {
        return { status: hit.status, payload: cloneJsonRecord(hit.payload), cached: true };
      }
      return { status: response.status, payload, cached: false };
    } catch (error) {
      if (hit) {
        return { status: hit.status, payload: cloneJsonRecord(hit.payload), cached: true };
      }
      throw error;
    } finally {
      inflight.delete(options.cacheKey);
    }
  })();

  inflight.set(options.cacheKey, inFlightPromise);
  const result = await inFlightPromise;
  return { status: result.status, payload: cloneJsonRecord(result.payload), cached: result.cached };
}
