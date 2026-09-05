import Link from 'next/link';
import {
  DEFAULT_MASTER_CALENDAR_TITLE,
  DEFAULT_THROWING_FIELDS,
  getMasterCalendarTitle,
  getScheduleThrowingState,
  getThrowingFieldSchema,
  listPlayerGroups,
  listPlayerIdsForGroup,
  listPlayerChoicesByOrganization,
  listProgramItemsForPlayerByDateRange,
  resolveOrganizationIdForSchool,
} from '../../../../lib/training-db';
import { requirePortalSession } from '../../../../lib/portal-session';
import {
  canUseProgrammingData,
  getSchoolProductAccess,
  resolveProgrammingOrganizationId,
  resolveProgrammingSchoolCode,
} from '../../../../lib/programming-scope';
import { resolveSchoolBrand } from '../../../../lib/school-brand';
import MasterCalendarTabs from './master-calendar-tabs';
import MasterCalendarGroupFilter from './master-calendar-group-filter';

type MasterCalendarPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function todayIsoDate(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDays(value: string | string[] | undefined): 1 | 3 | 7 {
  const raw = typeof value === 'string' ? Number(value) : Number.NaN;
  if (raw === 1 || raw === 3 || raw === 7) return raw;
  return 7;
}

function parseGroupIds(value: string | string[] | undefined): number[] | null {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  if (values.length === 0 || values.some((item) => item.trim().toLowerCase() === 'all')) return null;
  const ids = values
    .map((item) => Number(item))
    .filter((id) => Number.isInteger(id) && id > 0);
  return [...new Set(ids)];
}

export default async function MasterCalendarPage({ searchParams }: MasterCalendarPageProps) {
  const session = await requirePortalSession();
  const programmingSchoolCode = resolveProgrammingSchoolCode(session);
  const programmingDataAllowed = await canUseProgrammingData(session);
  const schoolAccess =
    session.role === 'admin'
      ? await getSchoolProductAccess(programmingSchoolCode)
      : { dashboard: true, programming: programmingDataAllowed, clientManagement: true };
  const canAccessProgramming = session.role === 'admin' ? schoolAccess.programming : programmingDataAllowed;
  const fallbackOrganizationId = await resolveProgrammingOrganizationId(session);
  const programmingOrganizationId = canAccessProgramming
    ? await resolveOrganizationIdForSchool({
        schoolCode: programmingSchoolCode,
        fallbackOrganizationId,
        createIfMissing: false,
      })
    : 0;
  const params = await searchParams;
  const startDateRaw = typeof params.startDate === 'string' ? params.startDate : '';
  const days = parseDays(params.days);
  const requestedGroupIds = parseGroupIds(params.groupId);
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(startDateRaw) ? startDateRaw : todayIsoDate();
  const endDate = addDays(startDate, days);
  const dayKeys = Array.from({ length: days }, (_, i) => addDays(startDate, i));
  const previousStartDate = addDays(startDate, -days);
  const nextStartDate = addDays(startDate, days);

  const [allPlayers, playerGroups] = programmingOrganizationId > 0
    ? await Promise.all([
        listPlayerChoicesByOrganization({
          organizationId: programmingOrganizationId,
          assignedCoachUserId: null,
          activeOnly: true,
        }).catch(() => []),
        listPlayerGroups({ organizationId: programmingOrganizationId }).catch(() => []),
      ])
    : [[], []];
  const matchedGroupIds = requestedGroupIds?.filter((id) => playerGroups.some((group) => group.id === id)) ?? null;
  const validGroupIds = matchedGroupIds && matchedGroupIds.length > 0 ? matchedGroupIds : null;
  const selectedPlayerIds = validGroupIds === null
    ? null
    : new Set((await Promise.all(
        validGroupIds.map((groupId) => listPlayerIdsForGroup({ organizationId: programmingOrganizationId, groupId }).catch(() => []))
      )).flat());
  const players = selectedPlayerIds === null
    ? allPlayers
    : allPlayers.filter((player) => selectedPlayerIds.has(player.playerId));

  const calendarHref = (date: string) => {
    const query = new URLSearchParams({ startDate: date, days: String(days) });
    validGroupIds?.forEach((groupId) => query.append('groupId', String(groupId)));
    return `/portal/admin/master-calendar?${query.toString()}`;
  };

  const itemsByPlayer = new Map<number, Awaited<ReturnType<typeof listProgramItemsForPlayerByDateRange>>>();
  const throwingByPlayer = new Map<number, Record<string, unknown>>();
  await Promise.all(
    players.map(async (player) => {
      const [rows, throwingState] = await Promise.all([
        listProgramItemsForPlayerByDateRange({
          playerId: player.playerId,
          startDate,
          endDate,
        }).catch(() => []),
        programmingOrganizationId > 0
          ? getScheduleThrowingState({ organizationId: programmingOrganizationId, playerId: player.playerId }).catch(() => ({
              byDate: {},
              weekNotes: {},
              templates: [],
            }))
          : Promise.resolve({ byDate: {}, weekNotes: {}, templates: [] }),
      ]);
      itemsByPlayer.set(player.playerId, rows);
      throwingByPlayer.set(player.playerId, throwingState.byDate ?? {});
    })
  );

  const throwingFieldSchema =
    programmingOrganizationId > 0
      ? await getThrowingFieldSchema({ organizationId: programmingOrganizationId }).catch(() => DEFAULT_THROWING_FIELDS)
      : DEFAULT_THROWING_FIELDS;

  const initialTitle =
    programmingOrganizationId > 0
      ? await getMasterCalendarTitle({ organizationId: programmingOrganizationId }).catch(() => DEFAULT_MASTER_CALENDAR_TITLE)
      : DEFAULT_MASTER_CALENDAR_TITLE;

  const schoolBrand = resolveSchoolBrand(programmingSchoolCode);

  const sortedPlayers = [...players].sort((a, b) => a.fullName.localeCompare(b.fullName));

  const itemsByPlayerPlain: Record<number, { dayDate: string; itemType: 'exercise' | 'workout'; itemName: string }[]> = {};
  for (const [playerId, rows] of itemsByPlayer.entries()) {
    itemsByPlayerPlain[playerId] = rows.map((row) => ({ dayDate: row.dayDate, itemType: row.itemType, itemName: row.itemName }));
  }
  const throwingByPlayerPlain: Record<number, Record<string, Record<string, string>>> = {};
  for (const [playerId, byDate] of throwingByPlayer.entries()) {
    const out: Record<string, Record<string, string>> = {};
    for (const day of dayKeys) {
      const entry = (byDate[day] ?? {}) as Record<string, unknown>;
      const normalized: Record<string, string> = {};
      for (const field of throwingFieldSchema) normalized[field.key] = String(entry[field.key] ?? '');
      out[day] = normalized;
    }
    throwingByPlayerPlain[playerId] = out;
  }

  return (
    <div className="portal-admin-stack">
      <article className="portal-admin-card">
        <form method="get" className="portal-master-calendar-controls">
          <label>
            Start Date
            <input type="date" name="startDate" defaultValue={startDate} />
          </label>
          <label>
            Days
            <select name="days" defaultValue={String(days)}>
              <option value="1">1 day</option>
              <option value="3">3 days</option>
              <option value="7">7 days</option>
            </select>
          </label>
          <MasterCalendarGroupFilter
            groups={playerGroups.map((group) => ({ id: group.id, name: group.name }))}
            initialSelectedIds={validGroupIds ?? []}
          />
          <div className="portal-master-calendar-period-actions">
            <Link
              href={calendarHref(previousStartDate)}
              className="btn btn-ghost as-link"
              aria-label="Previous period"
            >
              ← Prev
            </Link>
            <Link
              href={calendarHref(nextStartDate)}
              className="btn btn-ghost as-link"
              aria-label="Next period"
            >
              Next →
            </Link>
          </div>
          <div className="portal-master-calendar-load-actions">
            <button type="submit" className="btn btn-primary">Load</button>
            <Link href="/portal/admin/schedule" className="btn btn-ghost as-link">Back to Schedule</Link>
          </div>
        </form>
      </article>

      <MasterCalendarTabs
        players={sortedPlayers.map((player) => ({ playerId: player.playerId, fullName: player.fullName }))}
        dayKeys={dayKeys}
        itemsByPlayer={itemsByPlayerPlain}
        throwingByPlayer={throwingByPlayerPlain}
        throwingFieldSchema={throwingFieldSchema}
        defaultTab="throwing"
        initialTitle={initialTitle}
        schoolLogoSrc={schoolBrand.logoSrc}
        schoolLogoAlt={schoolBrand.logoAlt}
        schoolCode={programmingSchoolCode}
        dateRangeLabel={`${startDate} to ${dayKeys[dayKeys.length - 1]}`}
      />
    </div>
  );
}
