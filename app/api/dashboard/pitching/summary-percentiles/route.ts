import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { fetchDashboardJsonWithCache } from '../../../../../lib/dashboard-route-cache';

type SummaryPercentileRequest = {
  rowKey: string;
  query: string;
  handedQuery?: string;
};

type Body = {
  requests?: SummaryPercentileRequest[];
  columns?: string[];
};

function isAllLikeRowValue(value: unknown): boolean {
  const text = String(value ?? '').trim().toLowerCase();
  return text === 'all' || text === 'all (pinned)';
}

function parseSortableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[%\s,]/g, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractColumnValues(
  payload: Record<string, unknown>,
  column: string
): number[] {
  const rows = Array.isArray(payload.table_rows) ? (payload.table_rows as Array<Record<string, unknown>>) : [];
  const splitColumn = String((Array.isArray(payload.table_columns) ? payload.table_columns[0] : '') || 'Pitcher');
  const out = rows
    .filter((row) => !isAllLikeRowValue(row[splitColumn]))
    .map((row) => parseSortableNumber(row[column]))
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  return out;
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Body;
  const requests = Array.isArray(body.requests) ? body.requests : [];
  const columns = Array.isArray(body.columns) ? body.columns.map((v) => String(v ?? '').trim()).filter(Boolean) : [];
  if (!requests.length || !columns.length) {
    return NextResponse.json({ distributions: {}, handed_distributions: {} });
  }

  const inputUrl = new URL(request.url);
  const origin = inputUrl.origin;
  const cookieHeader = cookieStore
    .getAll()
    .map((item) => `${item.name}=${item.value}`)
    .join('; ');
  const distributions: Record<string, number[]> = {};
  const handedDistributions: Record<string, number[]> = {};

  await Promise.all(
    requests.map(async (entry) => {
      const rowKey = String(entry.rowKey ?? '').trim();
      const query = String(entry.query ?? '').trim();
      if (!rowKey || !query) return;

      const baseUrl = new URL('/api/dashboard/pitching/table-rollup', origin);
      baseUrl.search = query;
      if ((baseUrl.searchParams.get('table_mode') ?? '').trim().toLowerCase() === 'custom') {
        baseUrl.searchParams.set('custom_columns', columns.join(','));
      }
      baseUrl.searchParams.set('include_chart_points', '0');
      baseUrl.searchParams.set('include_row_pitches', '0');
      baseUrl.searchParams.set('include_trend_rows', '0');
      baseUrl.searchParams.delete('chart_only');
      baseUrl.searchParams.delete('chart_points_limit');
      const baseResult = await fetchDashboardJsonWithCache({
        cacheKey: `pitching:summary-percentiles:base:${baseUrl.toString()}`,
        ttlMs: 300000,
        staleTtlMs: 1800000,
        timeoutMs: 120000,
        retries: 1,
        fetcher: () =>
          fetch(baseUrl.toString(), {
            cache: 'no-store',
            headers: cookieHeader ? { cookie: cookieHeader } : undefined,
          }),
      });
      if (baseResult.status < 200 || baseResult.status >= 300) return;

      for (const column of columns) {
        const values = extractColumnValues(baseResult.payload, column);
        if (values.length) distributions[`${rowKey}::${column}`] = values;
      }

      const handedQuery = String(entry.handedQuery ?? '').trim();
      if (!handedQuery) return;
      const handedUrl = new URL('/api/dashboard/pitching/table-rollup', origin);
      handedUrl.search = handedQuery;
      if ((handedUrl.searchParams.get('table_mode') ?? '').trim().toLowerCase() === 'custom') {
        handedUrl.searchParams.set('custom_columns', columns.join(','));
      }
      handedUrl.searchParams.set('include_chart_points', '0');
      handedUrl.searchParams.set('include_row_pitches', '0');
      handedUrl.searchParams.set('include_trend_rows', '0');
      handedUrl.searchParams.delete('chart_only');
      handedUrl.searchParams.delete('chart_points_limit');
      const handedResult = await fetchDashboardJsonWithCache({
        cacheKey: `pitching:summary-percentiles:handed:${handedUrl.toString()}`,
        ttlMs: 300000,
        staleTtlMs: 1800000,
        timeoutMs: 120000,
        retries: 1,
        fetcher: () =>
          fetch(handedUrl.toString(), {
            cache: 'no-store',
            headers: cookieHeader ? { cookie: cookieHeader } : undefined,
          }),
      });
      if (handedResult.status < 200 || handedResult.status >= 300) return;
      for (const column of columns) {
        const values = extractColumnValues(handedResult.payload, column);
        if (values.length) handedDistributions[`${rowKey}::${column}`] = values;
      }
    })
  );

  return NextResponse.json({
    distributions,
    handed_distributions: handedDistributions,
  });
}
