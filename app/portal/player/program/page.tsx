import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requirePortalSession } from '../../../../lib/portal-session';
import {
  getPlayerByIdInOrganization,
  getPlayerForUser,
  listClientsByOrganization,
  listProgramItemsForPlayerByMonth,
} from '../../../../lib/training-db';
import LogoutButton from '../../logout-button';
import PlayerCalendar from '../player-calendar';

type PlayerProgramPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function getMonthFromParams(value: string | string[] | undefined): string {
  const asString = typeof value === 'string' ? value : '';
  if (/^\d{4}-\d{2}$/.test(asString)) return asString;
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function readMessage(params: Record<string, string | string[] | undefined>) {
  const ok = typeof params.ok === 'string' ? params.ok : '';
  const error = typeof params.error === 'string' ? params.error : '';
  return { ok, error };
}

function monthRange(month: string): { startDate: string; endDate: string } {
  const [yearRaw, monthRaw] = month.split('-');
  const year = Number(yearRaw);
  const monthIndex = Number(monthRaw) - 1;
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 1));
  const startDate = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}-${String(
    start.getUTCDate()
  ).padStart(2, '0')}`;
  const endDate = `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, '0')}-${String(
    end.getUTCDate()
  ).padStart(2, '0')}`;
  return { startDate, endDate };
}

export default async function PlayerProgramPage({ searchParams }: PlayerProgramPageProps) {
  const session = await requirePortalSession();
  const params = await searchParams;
  const previewPlayerIdRaw = typeof params.previewPlayerId === 'string' ? params.previewPlayerId : '';
  const previewSelf = typeof params.preview === 'string' ? params.preview === 'self' : false;
  const month = getMonthFromParams(params.month);
  const { ok, error } = readMessage(params);

  let effectivePlayerId: number | null = null;

  if (session.role === 'admin') {
    if (previewPlayerIdRaw) {
      const parsed = Number(previewPlayerIdRaw);
      if (Number.isFinite(parsed)) {
        effectivePlayerId = parsed;
      }
    }

    if (!effectivePlayerId && !previewSelf) {
      redirect('/portal/admin/clients');
    }
  }

  if (session.role === 'player') {
    const ownPlayer = await getPlayerForUser({
      organizationId: session.organizationId,
      userId: session.userId,
    });
    effectivePlayerId = ownPlayer?.id ?? session.playerId;
  }

  if (!effectivePlayerId) {
    return (
      <div className="portal-shell">
        <header className="portal-header">
          <div className="portal-header-left" aria-hidden="true" />
          <div className="portal-header-center">
            <nav className="portal-nav" aria-label="Portal Navigation">
              <Link href="/portal" className="portal-nav-link">
                Dashboard
              </Link>
              {session.role === 'admin' && (
                <Link href="/portal/admin" className="portal-nav-link">
                  Admin
                </Link>
              )}
              <Link href="/portal/player" className="portal-nav-link">
                Profile
              </Link>
              <Link href="/portal/player/program" className="portal-nav-link active">
                Program
              </Link>
            </nav>
          </div>
          <div className="portal-header-right">
            <div className="portal-user-meta" aria-label="Logged in user">
              <p>Logged In As</p>
              <h1>{session.name ?? session.email}</h1>
            </div>
            <LogoutButton />
          </div>
        </header>
        <section className="portal-panel">
          <h2>Player Preview</h2>
          <p>Select a client from Admin &gt; Clients, then choose View Profile or Preview Program.</p>
        </section>
      </div>
    );
  }

  const [player, items] = await Promise.all([
    getPlayerByIdInOrganization({ organizationId: session.organizationId, playerId: effectivePlayerId }),
    listProgramItemsForPlayerByMonth({ playerId: effectivePlayerId, month }),
  ]);

  if (!player) {
    redirect('/portal/admin/clients');
  }

  const previewClients = session.role === 'admin' ? await listClientsByOrganization(session.organizationId) : [];
  const initialRange = monthRange(month);

  return (
    <div className="portal-shell">
      <header className="portal-header">
        <div className="portal-header-left">
          {session.role === 'admin' ? (
            <form method="get" className="portal-preview-form">
              <label>
                Preview Athlete
                <select name="previewPlayerId" defaultValue={String(effectivePlayerId)}>
                  {previewClients.map((client) => (
                    <option key={client.playerId} value={String(client.playerId)}>
                      {client.fullName}
                    </option>
                  ))}
                </select>
              </label>
              <input type="hidden" name="month" value={month} />
              <button className="btn btn-ghost" type="submit">
                Switch
              </button>
            </form>
          ) : (
            <span className="portal-app-trigger">Player Program</span>
          )}
        </div>
        <div className="portal-header-center">
          <nav className="portal-nav" aria-label="Portal Navigation">
            {session.role === 'admin' && (
              <Link href="/portal/admin" className="portal-nav-link">
                Admin
              </Link>
            )}
            <Link
              href={
                session.role === 'admin' ? `/portal/player?previewPlayerId=${effectivePlayerId}` : '/portal/player'
              }
              className="portal-nav-link"
            >
              Profile
            </Link>
            <Link href="/portal/player/program" className="portal-nav-link active">
              Program
            </Link>
            <Link href="/tutorials" className="portal-nav-link">
              Tutorials
            </Link>
          </nav>
        </div>
        <div className="portal-header-right">
          <div className="portal-user-meta" aria-label="Logged in user">
            <p>{session.role === 'admin' ? 'Previewing' : 'Logged In As'}</p>
            <h1>{session.role === 'admin' ? player.fullName : session.name ?? session.email}</h1>
          </div>
          <LogoutButton />
        </div>
      </header>

      <section className="portal-panel portal-player-panel">
        <div className="portal-month-header">
          <div>
            <h2>{player.fullName}</h2>
            <p>{month} calendar with daily throwing + workout assignments.</p>
          </div>
          <form method="get" className="portal-month-filter">
            {session.role === 'admin' && <input type="hidden" name="previewPlayerId" value={String(effectivePlayerId)} />}
            <label className="portal-inline-filter">
              Month
              <input type="month" name="month" defaultValue={month} />
            </label>
            <button type="submit" className="btn btn-ghost">
              Load
            </button>
          </form>
        </div>

        {ok && <p className="auth-message">{ok}</p>}
        {error && <p className="auth-error">{error}</p>}

        <PlayerCalendar
          playerId={player.id}
          initialItems={items}
          initialStartDate={initialRange.startDate}
          initialEndDate={initialRange.endDate}
        />
      </section>
    </div>
  );
}
