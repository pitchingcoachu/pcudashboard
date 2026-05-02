type JsonRecord = Record<string, unknown>;

type CacheEntry = {
  at: number;
  expiresAt: number;
  staleUntil: number;
  status: number;
  payload: JsonRecord;
};

const GLOBAL_CACHE_KEY = '__pcu_dashboard_route_cache_v1__';
const GLOBAL_INFLIGHT_KEY = '__pcu_dashboard_route_cache_inflight_v1__';
const MAX_ENTRIES = 800;
export type DashboardCacheSource = 'HIT' | 'MISS' | 'STALE';
export type DashboardFetchResult = {
  status: number;
  payload: JsonRecord;
  cached: boolean;
  source: DashboardCacheSource;
  durationMs: number;
};

function errorContainsTimeout(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  if (message.includes('timeout') || message.includes('timed out') || message.includes('headers timeout')) {
    return true;
  }
  const withCause = error as Error & { cause?: unknown };
  const cause = withCause.cause as { code?: string; message?: string } | undefined;
  if (!cause) return false;
  const code = String(cause.code ?? '').toUpperCase();
  if (code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'ABORT_ERR') return true;
  const causeMessage = String(cause.message ?? '').toLowerCase();
  return causeMessage.includes('timeout') || causeMessage.includes('timed out');
}

function getCacheStore(): Map<string, CacheEntry> {
  const globalRef = globalThis as typeof globalThis & {
    [GLOBAL_CACHE_KEY]?: Map<string, CacheEntry>;
  };
  if (!globalRef[GLOBAL_CACHE_KEY]) {
    globalRef[GLOBAL_CACHE_KEY] = new Map<string, CacheEntry>();
  }
  return globalRef[GLOBAL_CACHE_KEY]!;
}

function getInflightStore(): Map<string, Promise<DashboardFetchResult>> {
  const globalRef = globalThis as typeof globalThis & {
    [GLOBAL_INFLIGHT_KEY]?: Map<string, Promise<DashboardFetchResult>>;
  };
  if (!globalRef[GLOBAL_INFLIGHT_KEY]) {
    globalRef[GLOBAL_INFLIGHT_KEY] = new Map<string, Promise<DashboardFetchResult>>();
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

function pruneExpiredEntries(store: Map<string, CacheEntry>, now: number) {
  for (const [key, entry] of store.entries()) {
    if (entry.staleUntil <= now) store.delete(key);
  }
}

export async function fetchDashboardJsonWithCache(options: {
  cacheKey: string;
  ttlMs: number;
  staleTtlMs?: number;
  timeoutMs?: number;
  retries?: number;
  fetcher: (signal?: AbortSignal) => Promise<Response>;
}): Promise<DashboardFetchResult> {
  const store = getCacheStore();
  const inflight = getInflightStore();
  const now = Date.now();
  const startedAt = now;
  pruneExpiredEntries(store, now);
  const hit = store.get(options.cacheKey);
  const staleTtlMs = Math.max(0, options.staleTtlMs ?? Math.max(15000, options.ttlMs * 4));
  const timeoutMs = Math.max(1000, options.timeoutMs ?? 30000);
  const retries = Math.max(0, options.retries ?? 1);
  const staleUntil = hit ? Number((hit as CacheEntry & { staleUntil?: number }).staleUntil ?? hit.expiresAt) : 0;
  const staleHit = hit && staleUntil > now ? hit : null;
  if (hit && hit.expiresAt > now) {
    return { status: hit.status, payload: cloneJsonRecord(hit.payload), cached: true, source: 'HIT', durationMs: Date.now() - startedAt };
  }

  const inflightHit = inflight.get(options.cacheKey);
  if (inflightHit) {
    const shared = await inflightHit;
    return {
      status: shared.status,
      payload: cloneJsonRecord(shared.payload),
      cached: shared.cached,
      source: shared.source,
      durationMs: Date.now() - startedAt,
    };
  }

  const inFlightPromise: Promise<DashboardFetchResult> = (async () => {
    try {
      let response: Response | null = null;
      let attempt = 0;
      while (attempt <= retries) {
        attempt += 1;
        try {
          const controller = new AbortController();
          const timeoutMessage = `Dashboard API timeout after ${timeoutMs}ms`;
          let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
          const timeoutPromise = new Promise<Response>((_, reject) => {
            timeoutHandle = setTimeout(() => {
              controller.abort();
              reject(new Error(timeoutMessage));
            }, timeoutMs);
          });
          try {
            response = await Promise.race([options.fetcher(controller.signal), timeoutPromise]);
          } catch (error) {
            if (
              error instanceof Error &&
              (error.name === 'AbortError' || error.message.toLowerCase().includes('aborted') || errorContainsTimeout(error))
            ) {
              throw new Error(timeoutMessage);
            }
            throw error;
          } finally {
            if (timeoutHandle) clearTimeout(timeoutHandle);
          }
          break;
        } catch (error) {
          if (attempt > retries) throw error;
        }
      }

      if (!response) throw new Error('Dashboard API request failed.');

      const rawPayload = (await response.json().catch(() => ({}))) as JsonRecord;
      const payload = cloneJsonRecord(rawPayload);
      if (response.status < 500) {
        const freshTtl = Math.max(250, options.ttlMs);
        const writeNow = Date.now();
        store.set(options.cacheKey, {
          at: writeNow,
          expiresAt: writeNow + freshTtl,
          staleUntil: writeNow + freshTtl + staleTtlMs,
          status: response.status,
          payload: cloneJsonRecord(payload),
        });
        pruneOldestEntries(store, MAX_ENTRIES);
        return { status: response.status, payload, cached: false, source: 'MISS', durationMs: Date.now() - startedAt };
      }
      if (staleHit) {
        return {
          status: staleHit.status,
          payload: cloneJsonRecord(staleHit.payload),
          cached: true,
          source: 'STALE',
          durationMs: Date.now() - startedAt,
        };
      }
      return { status: response.status, payload, cached: false, source: 'MISS', durationMs: Date.now() - startedAt };
    } catch (error) {
      if (staleHit) {
        return {
          status: staleHit.status,
          payload: cloneJsonRecord(staleHit.payload),
          cached: true,
          source: 'STALE',
          durationMs: Date.now() - startedAt,
        };
      }
      throw error;
    } finally {
      inflight.delete(options.cacheKey);
    }
  })();

  inflight.set(options.cacheKey, inFlightPromise);
  const result = await inFlightPromise;
  return {
    status: result.status,
    payload: cloneJsonRecord(result.payload),
    cached: result.cached,
    source: result.source,
    durationMs: Date.now() - startedAt,
  };
}
