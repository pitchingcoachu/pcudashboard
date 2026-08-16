type ValdRegion = 'use' | 'aue' | 'euw';

type ValdTokenResponse = {
  access_token?: string;
  expires_in?: number;
};

type ValdProfile = {
  profileId: string;
  givenName: string;
  familyName: string;
  fullName: string;
};

type ValdResultDefinition = {
  resultId: number;
  resultName: string;
  resultUnitName: string | null;
  numberOfDecimalPlaces: number | null;
};

type ValdTestMetric = {
  resultId: number;
  value: number | null;
};

type ValdTest = {
  testId: string;
  profileId: string;
  teamId?: string | null;
  testType: string;
  recordedDateUtc: string;
  weight?: number | null;
  parameter?: ValdTestMetric;
  extendedParameters?: ValdTestMetric[];
};

type ValdTrialMetric = {
  resultId: number;
  metricName: string;
  metricUnit: string;
  value: number;
};

type ValdTrialMetricPoint = {
  trialId: string;
  dateTime: string;
  resultId: number;
  metricName: string;
  metricUnit: string;
  value: number;
};

type ValdPlayerSeriesPoint = {
  date: string;
  testType: string;
  primaryMetricName: string;
  primaryMetricUnit: string;
  primaryMetricValue: number | null;
};

export type ValdMetricRow = {
  testId: string;
  trialId?: string;
  date: string;
  dateTime?: string;
  testType: string;
  metricId: number;
  metricName: string;
  metricUnit: string;
  value: number;
  pointType?: 'average' | 'rep';
  pointLabel?: string;
};

export type ValdPlayerSnapshot = {
  playerName: string;
  profileId: string | null;
  testsCount: number;
  recentTests: Array<{
    testId: string;
    date: string;
    testType: string;
    primaryMetric: string;
    primaryValue: string;
  }>;
  metricAverages: Array<{
    metric: string;
    unit: string;
    average: number;
    samples: number;
  }>;
  trend: ValdPlayerSeriesPoint[];
  metricRows: ValdMetricRow[];
};

export type ValdSnapshot = {
  fetchedAt: string;
  tenantId: string;
  players: ValdPlayerSnapshot[];
};

type ValdSnapshotFetchOptions = {
  trialFetchLimitOverride?: number;
  multiPlayerTrialFetchLimitOverride?: number;
  lookbackDaysOverride?: number;
  testsWindowDaysOverride?: number;
  recentTestLimitOverride?: number;
  disableInMemoryCache?: boolean;
};

const DEFAULT_VALD_TOKEN_URL = 'https://auth.prd.vald.com/oauth/token';
const DEFAULT_LOOKBACK_DAYS = 180;
const DEFAULT_TESTS_WINDOW_DAYS = 30;
const DEFAULT_SNAPSHOT_CACHE_TTL_MS = 300_000;
const DEFAULT_TRIAL_FETCH_LIMIT = 4;
const DEFAULT_MULTI_PLAYER_TRIAL_FETCH_LIMIT = 0;
const DEFAULT_RECENT_TEST_LIMIT = 150;
const VALD_TEST_PAGE_LIMIT = 50;

const regionBases: Record<ValdRegion, { profiles: string; forcedecks: string }> = {
  use: {
    profiles: 'https://prd-use-api-externalprofile.valdperformance.com',
    forcedecks: 'https://prd-use-api-extforcedecks.valdperformance.com',
  },
  aue: {
    profiles: 'https://prd-aue-api-externalprofile.valdperformance.com',
    forcedecks: 'https://prd-aue-api-extforcedecks.valdperformance.com',
  },
  euw: {
    profiles: 'https://prd-euw-api-externalprofile.valdperformance.com',
    forcedecks: 'https://prd-euw-api-extforcedecks.valdperformance.com',
  },
};

function readRegion(): ValdRegion {
  const raw = String(process.env.VALD_REGION ?? 'use').trim().toLowerCase();
  if (raw === 'aue' || raw === 'euw') return raw;
  return 'use';
}

function normalizeName(value: string): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const firstLast = raw.includes(',')
    ? (() => {
        const [last, ...rest] = raw.split(',').map((x) => x.trim());
        const first = rest.join(' ').trim();
        return first && last ? `${first} ${last}` : raw;
      })()
    : raw;
  return firstLast
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function nameTokens(value: string): string[] {
  const raw = String(value ?? '').trim().toLowerCase().replace(/\./g, ' ');
  return raw
    .split(/[^a-z0-9]+/g)
    .map((t) => t.trim())
    .filter(Boolean);
}

function findBestProfileMatch(name: string, profiles: ValdProfile[], profilesByNorm: Map<string, ValdProfile>): ValdProfile | null {
  const normalizedInput = normalizeName(name);
  const exact = profilesByNorm.get(normalizedInput);
  if (exact) {
    if (String(process.env.VALD_MATCH_DEBUG ?? '').trim() === '1') {
      console.info('[vald-match] exact', { inputName: name, profileName: exact.fullName, profileId: exact.profileId });
    }
    return exact;
  }
  const targetTokens = nameTokens(name);
  if (!targetTokens.length) return null;
  const targetFirst = targetTokens[0];
  const targetLast = targetTokens[targetTokens.length - 1];
  let best: { profile: ValdProfile; score: number } | null = null;
  for (const profile of profiles) {
    const tokens = nameTokens(profile.fullName);
    if (!tokens.length) continue;
    const first = tokens[0];
    const last = tokens[tokens.length - 1];
    if (!first || !last) continue;
    if (last !== targetLast) continue;
    let score = 1;
    if (first === targetFirst) score += 2;
    const overlap = targetTokens.filter((t) => tokens.includes(t)).length;
    score += overlap;
    if (!best || score > best.score) best = { profile, score };
  }
  if (best?.profile) {
    if (String(process.env.VALD_MATCH_DEBUG ?? '').trim() === '1') {
      console.info('[vald-match] fuzzy', {
        inputName: name,
        profileName: best.profile.fullName,
        profileId: best.profile.profileId,
        score: best.score,
      });
    }
    return best.profile;
  }
  if (String(process.env.VALD_MATCH_DEBUG ?? '').trim() === '1') {
    console.info('[vald-match] miss', { inputName: name, normalizedInput });
  }
  return null;
}

function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - Math.max(1, days));
  return date.toISOString().slice(0, 10) + 'T00:00:00.000Z';
}

function addUtcDays(iso: string, days: number): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10) + 'T00:00:00.000Z';
}

let tokenCache: { token: string; expiresAt: number } | null = null;
let snapshotCache = new Map<string, { expiresAt: number; value: ValdSnapshot }>();
let snapshotInflight = new Map<string, Promise<ValdSnapshot>>();

function parseRetryAfterMs(raw: string): number | null {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;
  const asSeconds = Number(trimmed);
  if (Number.isFinite(asSeconds) && asSeconds > 0) return Math.round(asSeconds * 1000);
  const asDate = Date.parse(trimmed);
  if (!Number.isFinite(asDate)) return null;
  const delta = asDate - Date.now();
  return delta > 0 ? delta : null;
}

function snapshotCacheKey(options: { tenantId: string; region: ValdRegion; playerNames: string[]; lookbackDays: number }): string {
  const names = [...options.playerNames].map((name) => normalizeName(name)).sort();
  return `${options.tenantId}|${options.region}|${options.lookbackDays}|${names.join(',')}`;
}

function cloneSnapshot(snapshot: ValdSnapshot): ValdSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as ValdSnapshot;
}

async function getValdToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 30_000) return tokenCache.token;
  const clientId = String(process.env.VALD_CLIENT_ID ?? '').trim();
  const clientSecret = String(process.env.VALD_CLIENT_SECRET ?? '').trim();
  if (!clientId || !clientSecret) {
    throw new Error('VALD credentials are not configured.');
  }

  const tokenUrl = String(process.env.VALD_TOKEN_URL ?? DEFAULT_VALD_TOKEN_URL).trim() || DEFAULT_VALD_TOKEN_URL;
  const audience = String(process.env.VALD_AUDIENCE ?? 'vald-api-external').trim();
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });
  if (audience) body.set('audience', audience);
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    cache: 'no-store',
  });
  const payload = (await response.json().catch(() => ({}))) as ValdTokenResponse & { error?: string; error_description?: string };
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || 'Unable to authenticate with VALD.');
  }
  const expiresIn = Number(payload.expires_in ?? 7200);
  tokenCache = {
    token: payload.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
  };
  return payload.access_token;
}

async function valdGetJson<T>(baseUrl: string, path: string, query: Record<string, string>): Promise<T> {
  const token = await getValdToken();
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(query)) {
    if (!value) continue;
    url.searchParams.set(key, value);
  }
  const maxAttempts = Math.max(1, Math.min(4, Number(process.env.VALD_REQUEST_MAX_ATTEMPTS ?? 4)));
  const timeoutMs = Math.max(5_000, Number(process.env.VALD_REQUEST_TIMEOUT_MS ?? 30_000));
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(url.toString(), {
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
        },
        cache: 'no-store',
        signal: controller.signal,
      });
    } catch (error) {
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(12_000, 1000 * (2 ** (attempt - 1)))));
        continue;
      }
      throw new Error(error instanceof Error ? `VALD request failed: ${error.message}` : 'VALD request failed.');
    } finally {
      clearTimeout(timeout);
    }
    if (response.status === 204) return {} as T;
    const payload = (await response.json().catch(() => ({}))) as T & { message?: string; error?: string };
    if (response.ok) return payload;
    if (response.status === 429 && attempt < maxAttempts) {
      const retryAfterMs = parseRetryAfterMs(String(response.headers.get('retry-after') ?? ''));
      const jitterMs = Math.floor(Math.random() * 250);
      const backoffMs = retryAfterMs ?? Math.min(12_000, 1000 * (2 ** (attempt - 1)) + jitterMs);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      continue;
    }
    throw new Error(payload.message || payload.error || `VALD request failed (${response.status}).`);
  }
  throw new Error('VALD request failed (429).');
}

async function fetchTrialMetricsForTest(
  baseUrl: string,
  teamId: string,
  testId: string
): Promise<{ aggregate: ValdTrialMetric[]; raw: ValdTrialMetricPoint[] }> {
  if (!teamId || !testId) return { aggregate: [], raw: [] };
  const payload = await valdGetJson<unknown>(baseUrl, `/v2019q3/teams/${teamId}/tests/${testId}/trials`, {});
  const trials = Array.isArray(payload) ? payload : [];
  const aggregate = new Map<
    number,
    { metricName: string; metricUnit: string; sum: number; count: number }
  >();
  const raw: ValdTrialMetricPoint[] = [];
  for (const trial of trials) {
    const data = trial as Record<string, unknown>;
    const trialId = String(data.id ?? '').trim();
    const recordedUTC = String(data.recordedUTC ?? '').trim();
    const results = Array.isArray(data.results) ? (data.results as Array<Record<string, unknown>>) : [];
    for (const row of results) {
      const limb = String(row.limb ?? '').trim();
      const repeat = Number(row.repeat ?? 0);
      if (limb && limb !== 'Trial') continue;
      if (repeat !== 0) continue;
      const resultId = Number(row.resultId ?? 0);
      const value = Number(row.value);
      if (!Number.isFinite(resultId) || resultId <= 0 || !Number.isFinite(value)) continue;
      const definition = (row.definition as Record<string, unknown> | undefined) ?? {};
      const metricName = String(definition.name ?? definition.result ?? `Metric ${resultId}`).trim() || `Metric ${resultId}`;
      const metricUnit = String(definition.unit ?? '').trim();
      const normalizedValue = normalizeMetricValue(metricName, metricUnit, value);
      const current = aggregate.get(resultId) ?? { metricName, metricUnit, sum: 0, count: 0 };
      current.sum += normalizedValue;
      current.count += 1;
      aggregate.set(resultId, current);
      raw.push({
        trialId: trialId || `:`,
        dateTime: recordedUTC,
        resultId,
        metricName,
        metricUnit,
        value: normalizedValue,
      });
    }
  }
  const aggregateRows = Array.from(aggregate.entries())
    .map(([resultId, row]) => ({
      resultId,
      metricName: row.metricName,
      metricUnit: row.metricUnit,
      value: row.count ? row.sum / row.count : 0,
    }))
    .filter((row) => Number.isFinite(row.value));
  return { aggregate: aggregateRows, raw };
}

function coerceProfiles(payload: unknown): ValdProfile[] {
  const source = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { profiles?: unknown[] })?.profiles)
      ? (payload as { profiles: unknown[] }).profiles
      : [];
  return source
    .map((row) => {
      const data = row as Record<string, unknown>;
      const givenName = String(data.givenName ?? '').trim();
      const familyName = String(data.familyName ?? '').trim();
      const profileId = String(data.profileId ?? '').trim();
      const fullName = `${givenName} ${familyName}`.trim();
      return { profileId, givenName, familyName, fullName };
    })
    .filter((row) => row.profileId && row.fullName);
}

function coerceDefinitions(payload: unknown): Map<number, ValdResultDefinition> {
  const source = Array.isArray((payload as { resultDefinitions?: unknown[] })?.resultDefinitions)
    ? ((payload as { resultDefinitions: unknown[] }).resultDefinitions as unknown[])
    : [];
  const map = new Map<number, ValdResultDefinition>();
  for (const row of source) {
    const data = row as Record<string, unknown>;
    const resultId = Number(data.resultId ?? 0);
    if (!Number.isFinite(resultId) || resultId <= 0) continue;
    map.set(resultId, {
      resultId,
      resultName: String(data.resultName ?? data.resultIdString ?? `Result ${resultId}`),
      resultUnitName: String(data.resultUnitName ?? '').trim() || null,
      numberOfDecimalPlaces: Number.isFinite(Number(data.numberOfDecimalPlaces))
        ? Number(data.numberOfDecimalPlaces)
        : null,
    });
  }
  return map;
}

function coerceTests(payload: unknown): ValdTest[] {
  const source = Array.isArray((payload as { tests?: unknown[] })?.tests)
    ? ((payload as { tests: unknown[] }).tests as unknown[])
    : [];
  return source
    .map((row) => {
      const data = row as Record<string, unknown>;
      const parameterRaw = data.parameter as Record<string, unknown> | undefined;
      const extendedRaw = Array.isArray(data.extendedParameters) ? (data.extendedParameters as Array<Record<string, unknown>>) : [];
      const mapMetric = (metric: Record<string, unknown>): ValdTestMetric => ({
        resultId: Number(metric.resultId ?? 0),
        value: Number.isFinite(Number(metric.value)) ? Number(metric.value) : null,
      });
      return {
        testId: String(data.testId ?? '').trim(),
        profileId: String(data.profileId ?? '').trim(),
        teamId: String(data.teamId ?? data.teamID ?? data.teamid ?? '').trim() || null,
        testType: String(data.testType ?? '').trim() || 'Unknown',
        recordedDateUtc: String(data.recordedDateUtc ?? '').trim(),
        weight: Number.isFinite(Number(data.weight)) ? Number(data.weight) : null,
        parameter: parameterRaw ? mapMetric(parameterRaw) : undefined,
        extendedParameters: extendedRaw.map(mapMetric).filter((x) => x.resultId > 0),
      };
    })
    .filter((row) => row.testId && row.profileId && row.recordedDateUtc);
}

async function fetchAllTestsWindowed(
  baseUrl: string,
  tenantId: string,
  modifiedFromUtc: string,
  windowDays: number
): Promise<unknown[]> {
  const start = new Date(modifiedFromUtc);
  const now = new Date();
  if (Number.isNaN(start.getTime())) {
    return [];
  }
  const all: unknown[] = [];
  const seen = new Set<string>();
  const WINDOW_DAYS = Math.max(1, Number.isFinite(windowDays) ? Math.floor(windowDays) : DEFAULT_TESTS_WINDOW_DAYS);
  const fetchRange = async (fromUtc: string, toUtc: string, depth = 0): Promise<unknown[]> => {
    const payload = await valdGetJson<unknown>(baseUrl, '/tests', {
      tenantId,
      modifiedFromUtc: fromUtc,
      modifiedToUtc: toUtc,
    });
    const rows = Array.isArray((payload as { tests?: unknown[] })?.tests)
      ? ((payload as { tests: unknown[] }).tests as unknown[])
      : [];
    const fromMs = new Date(fromUtc).getTime();
    const toMs = new Date(toUtc).getTime();
    // VALD's /tests endpoint appears to only filter at day granularity, not
    // the finer hour-level precision this bisection originally assumed
    // (confirmed directly: a 1-hour window and its parent day both returned
    // the exact same set of tests) -- splitting a window smaller than a day
    // never actually reduces the result count, so the old 1-hour split floor
    // let this recurse toward its depth cap on any day with >= 50 tests,
    // firing 800+ near-duplicate requests for a single 30-day lookback in
    // real testing. A ~1-day floor matches VALD's actual granularity.
    const ONE_DAY_MS = 24 * 3_600_000;
    const canSplit = Number.isFinite(fromMs) && Number.isFinite(toMs) && toMs - fromMs > ONE_DAY_MS;
    if (rows.length >= VALD_TEST_PAGE_LIMIT && canSplit && depth < 20) {
      const midpoint = new Date(fromMs + Math.floor((toMs - fromMs) / 2)).toISOString();
      const left = await fetchRange(fromUtc, midpoint, depth + 1);
      const right = await fetchRange(midpoint, toUtc, depth + 1);
      // If splitting produced no more distinct rows than the unsplit window
      // already had, VALD isn't actually differentiating between the two
      // halves (same day-granularity quirk) -- keep whichever side has
      // everything rather than silently duplicating/looping further only to
      // dedupe later at a cost of many more wasted requests.
      if (left.length + right.length <= rows.length) return rows;
      return [...left, ...right];
    }
    return rows;
  };
  let cursor = modifiedFromUtc;
  while (new Date(cursor).getTime() < now.getTime()) {
    const next = addUtcDays(cursor, WINDOW_DAYS);
    const upper = new Date(next).getTime() > now.getTime() ? now.toISOString() : next;
    const rows = await fetchRange(cursor, upper);
    for (const row of rows) {
      const id = String((row as Record<string, unknown>)?.testId ?? '').trim();
      if (!id) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      all.push(row);
    }
    cursor = upper;
  }
  return all;
}

function fmtValue(value: number | null, decimals: number): string {
  if (value === null || !Number.isFinite(value)) return '--';
  const safeDecimals = Math.max(0, Math.min(4, decimals));
  return value.toFixed(Math.min(1, safeDecimals));
}

function normalizeMetricValue(metricName: string, metricUnit: string, value: number): number {
  const normalized = String(metricName ?? '').trim().toLowerCase();
  const unit = String(metricUnit ?? '').trim().toLowerCase();
  if (
    normalized.includes('bodyweight') &&
    normalized.includes('pound') &&
    (value < 130 || unit === 'kg' || unit === 'kilo' || unit === 'kilogram' || unit === 'kilograms')
  ) {
    return value * 2.20462262185;
  }
  return value;
}

function isBodyWeightMetric(metricName: string): boolean {
  const normalized = String(metricName ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ');
  return normalized.includes('body weight') || normalized.includes('bodyweight') || normalized.includes('athlete weight');
}

function normalizeBodyWeightUnit(metricName: string, metricUnit: string): string {
  const normalizedName = String(metricName ?? '').trim().toLowerCase();
  const normalizedUnit = String(metricUnit ?? '').trim().toLowerCase();
  if (normalizedName.includes('pound') || normalizedUnit === 'lb' || normalizedUnit === 'lbs') return 'lb';
  if (normalizedUnit === 'kg' || normalizedUnit.includes('kilogram')) return 'kg';
  return metricUnit || 'kg';
}

function toShortDate(value: string): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw.slice(0, 10);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Phoenix',
    year: '2-digit',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(parsed);
  const month = parts.find((part) => part.type === 'month')?.value ?? '';
  const day = parts.find((part) => part.type === 'day')?.value ?? '';
  const year = parts.find((part) => part.type === 'year')?.value ?? '';
  if (!month || !day || !year) return raw.slice(0, 10);
  return `${month}/${day}/${year}`;
}

export async function fetchValdForceDecksSnapshot(
  playerNames: string[],
  options?: ValdSnapshotFetchOptions
): Promise<ValdSnapshot> {
  const tenantId = String(process.env.VALD_FORCEDECKS_TENANT_ID ?? process.env.VALD_TEAM_ID ?? '').trim();
  if (!tenantId) {
    throw new Error('VALD_FORCEDECKS_TENANT_ID is not configured.');
  }
  const region = readRegion();
  const baseDefault = regionBases[region];
  const base = {
    profiles: String(process.env.VALD_PROFILES_BASE_URL ?? baseDefault.profiles).trim() || baseDefault.profiles,
    forcedecks: String(process.env.VALD_FORCEDECKS_BASE_URL ?? baseDefault.forcedecks).trim() || baseDefault.forcedecks,
  };
  const lookbackDaysBase = Number(process.env.VALD_LOOKBACK_DAYS ?? DEFAULT_LOOKBACK_DAYS);
  const lookbackDays = Number.isFinite(Number(options?.lookbackDaysOverride))
    ? Number(options?.lookbackDaysOverride)
    : lookbackDaysBase;
  const testsWindowDaysBase = Math.max(1, Number(process.env.VALD_TESTS_WINDOW_DAYS ?? DEFAULT_TESTS_WINDOW_DAYS));
  const testsWindowDays = Number.isFinite(Number(options?.testsWindowDaysOverride))
    ? Math.max(1, Number(options?.testsWindowDaysOverride))
    : testsWindowDaysBase;
  const recentTestLimitBase = Math.max(25, Number(process.env.VALD_RECENT_TEST_LIMIT ?? DEFAULT_RECENT_TEST_LIMIT));
  const recentTestLimit = Number.isFinite(Number(options?.recentTestLimitOverride))
    ? Math.max(25, Number(options?.recentTestLimitOverride))
    : recentTestLimitBase;
  const snapshotCacheTtlMs = Math.max(0, Number(process.env.VALD_SNAPSHOT_CACHE_TTL_MS ?? DEFAULT_SNAPSHOT_CACHE_TTL_MS));
  const trialFetchLimitConfiguredBase = Math.max(0, Number(process.env.VALD_TRIAL_FETCH_LIMIT ?? DEFAULT_TRIAL_FETCH_LIMIT));
  const trialFetchLimitConfigured = Number.isFinite(Number(options?.trialFetchLimitOverride))
    ? Math.max(0, Number(options?.trialFetchLimitOverride))
    : trialFetchLimitConfiguredBase;
  const multiPlayerTrialFetchLimitBase = Math.max(
    0,
    Number(process.env.VALD_MULTI_PLAYER_TRIAL_FETCH_LIMIT ?? DEFAULT_MULTI_PLAYER_TRIAL_FETCH_LIMIT)
  );
  const multiPlayerTrialFetchLimit = Number.isFinite(Number(options?.multiPlayerTrialFetchLimitOverride))
    ? Math.max(0, Number(options?.multiPlayerTrialFetchLimitOverride))
    : multiPlayerTrialFetchLimitBase;
  const effectiveTrialFetchLimit = playerNames.length > 1 ? multiPlayerTrialFetchLimit : trialFetchLimitConfigured;
  const cacheKey = snapshotCacheKey({
    tenantId,
    region,
    playerNames,
    lookbackDays: Number.isFinite(lookbackDays) ? lookbackDays : DEFAULT_LOOKBACK_DAYS,
  });
  const useCache = options?.disableInMemoryCache ? false : true;
  const cached = snapshotCache.get(cacheKey);
  if (useCache && cached && cached.expiresAt > Date.now()) {
    console.info('[vald-forceplates] snapshot cache hit', {
      key: cacheKey,
      ttlMsRemaining: Math.max(0, cached.expiresAt - Date.now()),
      playerCount: playerNames.length,
    });
    return cloneSnapshot(cached.value);
  }
  console.info('[vald-forceplates] snapshot cache miss', {
    key: cacheKey,
    trialFetchLimitConfigured,
    multiPlayerTrialFetchLimit,
    effectiveTrialFetchLimit,
    snapshotCacheTtlMs,
    lookbackDays: Number.isFinite(lookbackDays) ? lookbackDays : DEFAULT_LOOKBACK_DAYS,
    testsWindowDays,
    recentTestLimit,
    playerCount: playerNames.length,
  });
  const existing = snapshotInflight.get(cacheKey);
  if (useCache && existing) {
    console.info('[vald-forceplates] snapshot inflight reuse', { key: cacheKey });
    return cloneSnapshot(await existing);
  }

  const run = (async (): Promise<ValdSnapshot> => {
  const modifiedFromUtc = isoDaysAgo(Number.isFinite(lookbackDays) ? lookbackDays : DEFAULT_LOOKBACK_DAYS);

  const [profilesPayload, defsPayload, testsPayloadRaw] = await Promise.all([
    valdGetJson<unknown>(base.profiles, '/profiles', { tenantId }),
    valdGetJson<unknown>(base.forcedecks, '/resultdefinitions', {}),
    fetchAllTestsWindowed(base.forcedecks, tenantId, modifiedFromUtc, testsWindowDays),
  ]);
  const testsPayload: { tests: unknown[] } = { tests: testsPayloadRaw };
  const profiles = coerceProfiles(profilesPayload);
  const resultDefs = coerceDefinitions(defsPayload);
  const tests = coerceTests(testsPayload);
  const profilesByNorm = new Map<string, ValdProfile>();
  for (const profile of profiles) {
    profilesByNorm.set(normalizeName(profile.fullName), profile);
  }

  const players: ValdPlayerSnapshot[] = [];
  for (const name of playerNames) {
    const profile = findBestProfileMatch(name, profiles, profilesByNorm);
    const playerTests = profile ? tests.filter((test) => test.profileId === profile.profileId) : [];
    const ordered = [...playerTests].sort((a, b) => b.recordedDateUtc.localeCompare(a.recordedDateUtc));
    const recent = ordered.slice(0, recentTestLimit);

    const series: ValdPlayerSeriesPoint[] = recent
      .map((test) => {
        const primary = test.parameter;
        const def = primary ? resultDefs.get(primary.resultId) : null;
        const unit = def?.resultUnitName ?? '';
        return {
          date: toShortDate(test.recordedDateUtc),
          testType: test.testType,
          primaryMetricName: def?.resultName ?? (primary ? `Metric ${primary.resultId}` : 'Primary'),
          primaryMetricUnit: unit,
          primaryMetricValue: primary?.value ?? null,
        };
      })
      .reverse();

    const metricValues = new Map<string, { unit: string; values: number[] }>();
    const metricRows: ValdMetricRow[] = [];
    const trialMetricsByTestId = new Map<string, ValdTrialMetric[]>();
    const trialRawByTestId = new Map<string, ValdTrialMetricPoint[]>();
    // Trial-detail fetches (one HTTP call per test, up to effectiveTrialFetchLimit
    // tests) used to run sequentially inside the loop below, one `await` at a
    // time -- with each VALD call taking a few seconds, that alone made a
    // single-player live lookup take 60-120+ seconds (confirmed via direct
    // testing). Firing them all in parallel up front (Promise.all) instead
    // -- same calls, same results, just concurrent -- cuts that down to
    // roughly the slowest single call instead of the sum of all of them.
    // The loop below is otherwise unchanged: it still processes tests in
    // order and does all its other bookkeeping inline, it just looks up the
    // already-fetched trial result instead of awaiting it itself.
    const trialFetchResults = await Promise.all(
      recent.map((test, idx) =>
        idx < effectiveTrialFetchLimit
          ? fetchTrialMetricsForTest(base.forcedecks, String(test.teamId ?? '').trim() || tenantId, test.testId).catch(
              () => ({ aggregate: [] as ValdTrialMetric[], raw: [] as ValdTrialMetricPoint[] })
            )
          : Promise.resolve({ aggregate: [] as ValdTrialMetric[], raw: [] as ValdTrialMetricPoint[] })
      )
    );
    for (let idx = 0; idx < recent.length; idx += 1) {
      const test = recent[idx];
      let hasBodyWeightMetricRow = false;
      const addMetricValue = (metricName: string, metricUnit: string, value: number) => {
        const key = `${metricName}__${metricUnit}`;
        const entry = metricValues.get(key) ?? { unit: metricUnit, values: [] };
        entry.values.push(value);
        metricValues.set(key, entry);
      };
      const addBodyWeightMetricRow = (metricId: number, rawMetricName: string, rawMetricUnit: string, rawValue: number) => {
        if (hasBodyWeightMetricRow || !Number.isFinite(rawValue) || rawValue <= 0) return;
        const metricUnit = normalizeBodyWeightUnit(rawMetricName, rawMetricUnit);
        const value = normalizeMetricValue(rawMetricName, rawMetricUnit, rawValue);
        metricRows.push({
          testId: test.testId,
          date: toShortDate(test.recordedDateUtc),
          dateTime: test.recordedDateUtc,
          testType: test.testType,
          metricId,
          metricName: 'Body Weight',
          metricUnit,
          value,
          pointType: 'average',
        });
        addMetricValue('Body Weight', metricUnit, value);
        hasBodyWeightMetricRow = true;
      };
      if (Number.isFinite(Number(test.weight)) && Number(test.weight) > 0) {
        addBodyWeightMetricRow(-1, 'Body Weight', 'kg', Number(test.weight));
      }
      const trialMetrics = trialFetchResults[idx] ?? { aggregate: [], raw: [] };
      if (idx >= effectiveTrialFetchLimit) {
        console.info('[vald-forceplates] trial fetch skipped by limit', {
          testId: test.testId,
          idx,
          effectiveTrialFetchLimit,
        });
      }
      trialMetricsByTestId.set(test.testId, trialMetrics.aggregate);
      trialRawByTestId.set(test.testId, trialMetrics.raw);

      const baseMetrics = [test.parameter, ...(test.extendedParameters ?? [])].filter(Boolean) as ValdTestMetric[];
      const trialAsMetrics = trialMetrics.aggregate.map((row) => ({
        resultId: row.resultId,
        value: row.value,
      }));
      const metricsById = new Map<number, ValdTestMetric>();
      for (const metric of baseMetrics) {
        if (!Number.isFinite(Number(metric.resultId)) || Number(metric.resultId) <= 0) continue;
        metricsById.set(Number(metric.resultId), metric);
      }
      for (const metric of trialAsMetrics) {
        if (!Number.isFinite(Number(metric.resultId)) || Number(metric.resultId) <= 0) continue;
        if (!metricsById.has(Number(metric.resultId))) {
          metricsById.set(Number(metric.resultId), metric);
        }
      }
      const metrics = Array.from(metricsById.values());
      for (const metric of metrics) {
        if (!Number.isFinite(Number(metric.value))) continue;
        const trialDef = trialMetricsByTestId.get(test.testId)?.find((row) => row.resultId === metric.resultId);
        const def = resultDefs.get(metric.resultId);
        const label = trialDef?.metricName ?? def?.resultName ?? `Metric ${metric.resultId}`;
        const unit = trialDef?.metricUnit ?? def?.resultUnitName ?? '';
        if (isBodyWeightMetric(label)) {
          addBodyWeightMetricRow(metric.resultId, label, unit, Number(metric.value));
          continue;
        }
        addMetricValue(label, unit, Number(metric.value));
        metricRows.push({
          testId: test.testId,
          date: toShortDate(test.recordedDateUtc),
          dateTime: test.recordedDateUtc,
          testType: test.testType,
          metricId: metric.resultId,
          metricName: label,
          metricUnit: unit,
          value: Number(metric.value),
          pointType: 'average',
        });
      }
      const trialPoints = trialRawByTestId.get(test.testId) ?? [];
      for (const point of trialPoints) {
        metricRows.push({
          testId: test.testId,
          trialId: point.trialId,
          date: toShortDate(point.dateTime || test.recordedDateUtc),
          dateTime: point.dateTime || test.recordedDateUtc,
          testType: test.testType,
          metricId: point.resultId,
          metricName: point.metricName,
          metricUnit: point.metricUnit,
          value: Number(point.value),
          pointType: 'rep',
          pointLabel: point.trialId,
        });
      }
    }

    const averages = Array.from(metricValues.entries())
      .map(([key, entry]) => {
        const metric = key.split('__')[0] ?? key;
        const sum = entry.values.reduce((acc, value) => acc + value, 0);
        const average = entry.values.length ? sum / entry.values.length : 0;
        return { metric, unit: entry.unit, average, samples: entry.values.length };
      })
      .filter((row) => row.samples >= 2)
      .sort((a, b) => b.samples - a.samples || a.metric.localeCompare(b.metric))
      .slice(0, 12);

    const recentRows = recent.map((test) => {
      const primary = test.parameter;
      const trialMetrics = trialMetricsByTestId.get(test.testId) ?? [];
      const def = primary ? resultDefs.get(primary.resultId) : null;
      const decimals = def?.numberOfDecimalPlaces ?? 2;
      const unit = def?.resultUnitName ?? '';
      const weightValue = Number.isFinite(Number(test.weight)) && Number(test.weight) > 0 ? Number(test.weight) : null;
      const trialPrimary =
        trialMetrics.find((row) => row.metricName.toLowerCase().includes('jump height')) ??
        trialMetrics.find((row) => row.metricName.toLowerCase().includes('rsi')) ??
        trialMetrics[0] ??
        null;
      const metricName = def?.resultName ?? (primary ? `Metric ${primary.resultId}` : (trialPrimary?.metricName ?? (weightValue !== null ? 'Body Weight' : 'Primary')));
      const trialUnit = trialPrimary?.metricUnit ?? '';
      const trialValue = trialPrimary?.value ?? null;
      return {
        testId: test.testId,
        date: toShortDate(test.recordedDateUtc),
        testType: test.testType,
        primaryMetric: metricName,
        primaryValue: primary
          ? `${fmtValue(primary.value, decimals)}${unit ? ` ${unit}` : ''}`
          : trialValue !== null && Number.isFinite(trialValue)
            ? `${fmtValue(trialValue, 2)}${trialUnit ? ` ${trialUnit}` : ''}`
          : weightValue !== null
            ? `${fmtValue(weightValue, 2)} kg`
            : '--',
      };
    });

    const snapshotRow: ValdPlayerSnapshot = {
      playerName: name,
      profileId: profile?.profileId ?? null,
      testsCount: playerTests.length,
      recentTests: recentRows,
      metricAverages: averages,
      trend: series,
      metricRows: metricRows.sort((a, b) => String(a.dateTime ?? a.date).localeCompare(String(b.dateTime ?? b.date))),
    };
    if (String(process.env.VALD_MATCH_DEBUG ?? '').trim() === '1') {
      console.info('[vald-match] result', {
        inputName: name,
        profileId: snapshotRow.profileId,
        testsCount: snapshotRow.testsCount,
      });
    }
    players.push(snapshotRow);
  }

  const result: ValdSnapshot = {
    fetchedAt: new Date().toISOString(),
    tenantId,
    players,
  };
  if (useCache && snapshotCacheTtlMs > 0) {
    snapshotCache.set(cacheKey, {
      expiresAt: Date.now() + snapshotCacheTtlMs,
      value: cloneSnapshot(result),
    });
    console.info('[vald-forceplates] snapshot cache write', {
      key: cacheKey,
      snapshotCacheTtlMs,
      playerCount: playerNames.length,
    });
    if (snapshotCache.size > 500) {
      const now = Date.now();
      for (const [key, value] of snapshotCache.entries()) {
        if (value.expiresAt <= now) snapshotCache.delete(key);
      }
    }
  }
  return result;
  })();

  if (useCache) snapshotInflight.set(cacheKey, run);
  try {
    return cloneSnapshot(await run);
  } finally {
    if (useCache) snapshotInflight.delete(cacheKey);
  }
}
