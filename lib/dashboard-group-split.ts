import { listDashboardPlayerGroups } from './training-db';

type GroupSplitPayload = Record<string, unknown> & {
  table_columns?: unknown[];
  table_rows?: unknown[];
};

export type DashboardGroupSplitResult = {
  status: number;
  payload: GroupSplitPayload;
};

function parseSelectedGroupIds(value: string | null): Set<number> {
  return new Set(
    String(value ?? '')
      .split(',')
      .map((entry) => Number(entry.trim()))
      .filter((id) => Number.isInteger(id) && id > 0)
  );
}

async function fetchJson(url: URL, timeoutMs: number): Promise<DashboardGroupSplitResult> {
  const response = await fetch(url.toString(), {
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = (await response.json().catch(() => ({}))) as GroupSplitPayload;
  return { status: response.status, payload };
}

/** Produces one accurately aggregated table row per player group by reusing
 * the dashboard API's existing All-row aggregation for each group. */
export async function fetchDashboardGroupSplit(input: {
  upstreamUrl: URL;
  organizationId: number;
  selectedGroupIds: string | null;
  startDate: string | null;
  endDate: string | null;
  playerParam: 'pitcher' | 'hitter' | 'catcher';
  timeoutMs: number;
}): Promise<DashboardGroupSplitResult> {
  const groups = await listDashboardPlayerGroups({
    organizationId: input.organizationId,
    startDate: input.startDate,
    endDate: input.endDate,
  });
  const selectedIds = parseSelectedGroupIds(input.selectedGroupIds);
  const activeGroups = groups.filter((group) => (
    group.memberNames.length > 0 && (selectedIds.size === 0 || selectedIds.has(group.id))
  ));

  if (activeGroups.length === 0) {
    return { status: 200, payload: { table_columns: ['Groups'], table_rows: [] } };
  }

  const unionMemberNames = Array.from(new Set(activeGroups.flatMap((group) => group.memberNames)));
  const baseUrl = new URL(input.upstreamUrl);
  baseUrl.searchParams.set('split_by', 'All');
  baseUrl.searchParams.set(input.playerParam, unionMemberNames.join(';'));

  const [baseResult, ...groupResults] = await Promise.all([
    fetchJson(baseUrl, input.timeoutMs),
    ...activeGroups.map((group) => {
      const groupUrl = new URL(baseUrl);
      groupUrl.searchParams.set(input.playerParam, group.memberNames.join(';'));
      return fetchJson(groupUrl, input.timeoutMs);
    }),
  ]);

  if (baseResult.status < 200 || baseResult.status >= 300) return baseResult;

  const columns = Array.isArray(baseResult.payload.table_columns)
    ? baseResult.payload.table_columns.map((column) => String(column ?? ''))
    : [];
  const originalSplitColumn = columns[0] || 'All';
  const tableRows: Record<string, unknown>[] = [];
  const failedGroups: string[] = [];

  groupResults.forEach((result, index) => {
    const group = activeGroups[index];
    if (result.status < 200 || result.status >= 300) {
      failedGroups.push(group.name);
      return;
    }
    const rows = Array.isArray(result.payload.table_rows)
      ? result.payload.table_rows.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
      : [];
    const aggregateRow = rows.find((row) => String(row[originalSplitColumn] ?? '').trim().toLowerCase() === 'all') ?? rows[0];
    if (!aggregateRow) return;
    const nextRow: Record<string, unknown> = { ...aggregateRow, Groups: group.name };
    if (originalSplitColumn !== 'Groups') delete nextRow[originalSplitColumn];
    tableRows.push(nextRow);
  });

  return {
    status: 200,
    payload: {
      ...baseResult.payload,
      table_columns: ['Groups', ...columns.slice(1)],
      table_rows: tableRows,
      ...(failedGroups.length > 0 ? { group_split_errors: failedGroups } : {}),
    },
  };
}
