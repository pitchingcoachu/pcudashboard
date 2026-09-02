import Link from 'next/link';
import {
  DEFAULT_MASTER_CALENDAR_TITLE,
  DEFAULT_THROWING_FIELDS,
  getMasterCalendarTitle,
  getScheduleThrowingState,
  getThrowingFieldSchema,
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
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(startDateRaw) ? startDateRaw : todayIsoDate();
  const endDate = addDays(startDate, days);
  const dayKeys = Array.from({ length: days }, (_, i) => addDays(startDate, i));
  const previousStartDate = addDays(startDate, -days);
  const nextStartDate = addDays(startDate, days);

  const players =
    programmingOrganizationId > 0
      ? await listPlayerChoicesByOrganization({
          organizationId: programmingOrganizationId,
          assignedCoachUserId: null,
          activeOnly: true,
        }).catch(() => [])
      : [];

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
        <form method="get" className="portal-form-grid" style={{ gridTemplateColumns: 'repeat(5, minmax(140px, 1fr))' }}>
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
          <div style={{ display: 'flex', alignItems: 'end', gap: 8 }}>
            <Link
              href={`/portal/admin/master-calendar?startDate=${previousStartDate}&days=${days}`}
              className="btn btn-ghost as-link"
              aria-label="Previous period"
            >
              ← Prev
            </Link>
            <Link
              href={`/portal/admin/master-calendar?startDate=${nextStartDate}&days=${days}`}
              className="btn btn-ghost as-link"
              aria-label="Next period"
            >
              Next →
            </Link>
          </div>
          <div style={{ display: 'flex', alignItems: 'end', gap: 8 }}>
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
        dateRangeLabel={`${startDate} to ${dayKeys[dayKeys.length - 1]}`}
      />
    </div>
  );
}
