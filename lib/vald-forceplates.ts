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

const DEFAULT_VALD_TOKEN_URL = 'https://auth.prd.vald.com/oauth/token';
const DEFAULT_LOOKBACK_DAYS = 180;

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
  const response = await fetch(url.toString(), {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
    },
    cache: 'no-store',
  });
  if (response.status === 204) return {} as T;
  const payload = (await response.json().catch(() => ({}))) as T & { message?: string; error?: string };
  if (!response.ok) {
    throw new Error(payload.message || payload.error || `VALD request failed (${response.status}).`);
  }
  return payload;
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
      const normalizedValue = normalizeMetricValue(metricName, value);
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
  modifiedFromUtc: string
): Promise<unknown[]> {
  const start = new Date(modifiedFromUtc);
  const now = new Date();
  if (Number.isNaN(start.getTime())) {
    return [];
  }
  const all: unknown[] = [];
  const seen = new Set<string>();
  const WINDOW_DAYS = 3;
  let cursor = modifiedFromUtc;
  while (new Date(cursor).getTime() < now.getTime()) {
    const next = addUtcDays(cursor, WINDOW_DAYS);
    const upper = new Date(next).getTime() > now.getTime() ? now.toISOString() : next;
    const payload = await valdGetJson<unknown>(baseUrl, '/tests', {
      tenantId,
      modifiedFromUtc: cursor,
      modifiedToUtc: upper,
    });
    const rows = Array.isArray((payload as { tests?: unknown[] })?.tests)
      ? ((payload as { tests: unknown[] }).tests as unknown[])
      : [];
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

function normalizeMetricValue(metricName: string, value: number): number {
  const normalized = String(metricName ?? '').trim().toLowerCase();
  if (normalized === 'bodyweight in pounds') return value * 2.2;
  return value;
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

export async function fetchValdForceDecksSnapshot(playerNames: string[]): Promise<ValdSnapshot> {
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
  const lookbackDays = Number(process.env.VALD_LOOKBACK_DAYS ?? DEFAULT_LOOKBACK_DAYS);
  const modifiedFromUtc = isoDaysAgo(Number.isFinite(lookbackDays) ? lookbackDays : DEFAULT_LOOKBACK_DAYS);

  const [profilesPayload, defsPayload, testsPayloadRaw] = await Promise.all([
    valdGetJson<unknown>(base.profiles, '/profiles', { tenantId }),
    valdGetJson<unknown>(base.forcedecks, '/resultdefinitions', {}),
    fetchAllTestsWindowed(base.forcedecks, tenantId, modifiedFromUtc),
  ]);
  const testsPayload: { tests: unknown[] } = { tests: testsPayloadRaw };
  const profiles = coerceProfiles(profilesPayload);
  const resultDefs = coerceDefinitions(defsPayload);
  const tests = coerceTests(testsPayload);
  const profilesByNorm = new Map<string, ValdProfile>();
  for (const profile of profiles) {
    profilesByNorm.set(normalizeName(profile.fullName), profile);
  }

  const players: ValdPlayerSnapshot[] = await Promise.all(playerNames.map(async (name) => {
    const normalized = normalizeName(name);
    const profile = profilesByNorm.get(normalized) ?? null;
    const playerTests = profile ? tests.filter((test) => test.profileId === profile.profileId) : [];
    const ordered = [...playerTests].sort((a, b) => b.recordedDateUtc.localeCompare(a.recordedDateUtc));
    const recent = ordered.slice(0, 25);

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
    for (const test of recent) {
      if (Number.isFinite(Number(test.weight)) && Number(test.weight) > 0) {
        metricRows.push({
          testId: test.testId,
          date: toShortDate(test.recordedDateUtc),
          dateTime: test.recordedDateUtc,
          testType: test.testType,
          metricId: -1,
          metricName: 'Body Weight',
          metricUnit: 'kg',
          value: Number(test.weight),
          pointType: 'average',
        });
      }
      let trialMetrics: { aggregate: ValdTrialMetric[]; raw: ValdTrialMetricPoint[] } = { aggregate: [], raw: [] };
      try {
        trialMetrics = await fetchTrialMetricsForTest(base.forcedecks, tenantId, test.testId);
      } catch {
        trialMetrics = { aggregate: [], raw: [] };
      }
      trialMetricsByTestId.set(test.testId, trialMetrics.aggregate);
      trialRawByTestId.set(test.testId, trialMetrics.raw);

      let metrics = [test.parameter, ...(test.extendedParameters ?? [])].filter(Boolean) as ValdTestMetric[];
      if (metrics.length === 0) {
        metrics = trialMetrics.aggregate.map((row) => ({
          resultId: row.resultId,
          value: row.value,
        }));
      }
      for (const metric of metrics) {
        if (!Number.isFinite(Number(metric.value))) continue;
        const trialDef = trialMetricsByTestId.get(test.testId)?.find((row) => row.resultId === metric.resultId);
        const def = resultDefs.get(metric.resultId);
        const label = trialDef?.metricName ?? def?.resultName ?? `Metric ${metric.resultId}`;
        const unit = trialDef?.metricUnit ?? def?.resultUnitName ?? '';
        const key = `${label}__${unit}`;
        const entry = metricValues.get(key) ?? { unit, values: [] };
        entry.values.push(Number(metric.value));
        metricValues.set(key, entry);
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

    const recentRows = recent.slice(0, 20).map((test) => {
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

    return {
      playerName: name,
      profileId: profile?.profileId ?? null,
      testsCount: playerTests.length,
      recentTests: recentRows,
      metricAverages: averages,
      trend: series,
      metricRows: metricRows.sort((a, b) => String(a.dateTime ?? a.date).localeCompare(String(b.dateTime ?? b.date))),
    };
  }));

  return {
    fetchedAt: new Date().toISOString(),
    tenantId,
    players,
  };
}
