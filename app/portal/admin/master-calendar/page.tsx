import Link from 'next/link';
import {
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
  return 3;
}

function labelDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'numeric',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export default async function MasterCalendarPage({ searchParams }: MasterCalendarPageProps) {
  const session = await requirePortalSession();
  const programmingSchoolCode = resolveProgrammingSchoolCode(session);
  const schoolAccess =
    session.role === 'admin'
      ? await getSchoolProductAccess(programmingSchoolCode)
      : { dashboard: true, programming: canUseProgrammingData(session), clientManagement: true };
  const canAccessProgramming = session.role === 'admin' ? schoolAccess.programming : canUseProgrammingData(session);
  const fallbackOrganizationId = resolveProgrammingOrganizationId(session);
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

  const players =
    programmingOrganizationId > 0
      ? await listPlayerChoicesByOrganization({
          organizationId: programmingOrganizationId,
          assignedCoachUserId: session.role === 'coach' ? (session.userId ?? 0) : null,
          activeOnly: true,
        }).catch(() => [])
      : [];

  const itemsByPlayer = new Map<number, Awaited<ReturnType<typeof listProgramItemsForPlayerByDateRange>>>();
  await Promise.all(
    players.map(async (player) => {
      const rows = await listProgramItemsForPlayerByDateRange({
        playerId: player.playerId,
        startDate,
        endDate,
      }).catch(() => []);
      itemsByPlayer.set(player.playerId, rows);
    })
  );

  const sortedPlayers = [...players].sort((a, b) => {
    const aRows = itemsByPlayer.get(a.playerId) ?? [];
    const bRows = itemsByPlayer.get(b.playerId) ?? [];
    const aMissingCount = dayKeys.reduce((count, day) => count + (aRows.some((row) => row.dayDate === day) ? 0 : 1), 0);
    const bMissingCount = dayKeys.reduce((count, day) => count + (bRows.some((row) => row.dayDate === day) ? 0 : 1), 0);
    if (aMissingCount !== bMissingCount) return bMissingCount - aMissingCount;
    return a.fullName.localeCompare(b.fullName);
  });

  return (
    <div className="portal-admin-stack">
      <div className="portal-admin-headline">
        <h2>Master Calendar</h2>
        <p>Read-only snapshot of every player schedule.</p>
      </div>

      <article className="portal-admin-card">
        <form method="get" className="portal-form-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(160px, 1fr))' }}>
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
            <button type="submit" className="btn btn-primary">Load</button>
            <Link href="/portal/admin/schedule" className="btn btn-ghost as-link">Back to Schedule</Link>
          </div>
        </form>
      </article>

      <article className="portal-admin-card" style={{ overflowX: 'auto' }}>
        <table className="portal-table" style={{ minWidth: 980 }}>
          <thead>
            <tr>
              <th>Player</th>
              {dayKeys.map((day) => (
                <th key={`head-${day}`}>{labelDate(day)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedPlayers.map((player) => {
              const rows = itemsByPlayer.get(player.playerId) ?? [];
              return (
                <tr key={player.playerId}>
                  <td>
                    <Link href={`/portal/admin/schedule?playerId=${player.playerId}`} className="portal-inline-link">
                      <strong>{player.fullName}</strong>
                    </Link>
                  </td>
                  {dayKeys.map((day) => {
                    const names = rows
                      .filter((row) => row.dayDate === day)
                      .map((row) => row.itemName)
                      .filter(Boolean);
                    return (
                      <td key={`${player.playerId}-${day}`}>
                        {names.length ? (
                          <div style={{ display: 'grid', gap: 4 }}>
                            {names.map((name, idx) => (
                              <span key={`${player.playerId}-${day}-${idx}`} className="portal-muted-text">{name}</span>
                            ))}
                          </div>
                        ) : (
                          <span style={{ color: 'rgba(248,113,113,0.95)' }}>None</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </article>
    </div>
  );
}
