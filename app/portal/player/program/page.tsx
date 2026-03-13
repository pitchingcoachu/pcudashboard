import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requirePortalSession } from '../../../../lib/portal-session';
import { canManagePlayer } from '../../../../lib/portal-access';
import {
  getPlayerByIdInOrganization,
  getPlayerForUser,
  listClientsByOrganization,
  listProgramItemsForPlayerByMonth,
} from '../../../../lib/training-db';
import MobileNavSelect from '../../mobile-nav-select';
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

  if (session.role === 'admin' || session.role === 'coach') {
    if (previewPlayerIdRaw) {
      const parsed = Number(previewPlayerIdRaw);
      if (Number.isFinite(parsed)) {
        effectivePlayerId = parsed;
      }
    }

    if (!effectivePlayerId && !previewSelf) {
      redirect(session.role === 'coach' ? '/portal/admin/schedule' : '/portal/admin/clients');
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
          <div className="portal-header-left">
            <Link href="/portal/player" className="portal-header-logo-link" aria-label="PCU Home">
              <img src="/pitching-coach-u-logo.png" alt="PCU logo" className="portal-header-logo" />
            </Link>
          </div>
          <div className="portal-header-center">
            <nav className="portal-nav" aria-label="Portal Navigation">
              <Link href="/portal/dashboard" className="portal-nav-link">
                PCU Dashboard
              </Link>
              {(session.role === 'admin' || session.role === 'coach') && (
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
            <MobileNavSelect
              currentHref="/portal/player/program"
              loggedInAs={session.name ?? session.email}
              items={[
                { href: '/portal/dashboard', label: 'PCU Dashboard' },
                ...(session.role === 'admin' || session.role === 'coach' ? [{ href: '/portal/admin', label: 'Admin' }] : []),
                { href: '/portal/player', label: 'Profile' },
                { href: '/portal/player/program', label: 'Program' },
              ]}
            />
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

  if (session.role === 'coach') {
    const allowed = await canManagePlayer(session, effectivePlayerId);
    if (!allowed) redirect('/portal/admin/schedule');
  }

  const [player, items] = await Promise.all([
    getPlayerByIdInOrganization({ organizationId: session.organizationId, playerId: effectivePlayerId }),
    listProgramItemsForPlayerByMonth({ playerId: effectivePlayerId, month }),
  ]);

  if (!player) {
    redirect(session.role === 'coach' ? '/portal/admin/schedule' : '/portal/admin/clients');
  }

  const previewClients =
    session.role === 'admin' || session.role === 'coach'
      ? (await listClientsByOrganization(session.organizationId)).filter(
          (client) => session.role === 'admin' || client.assignedCoachUserId === session.userId
        )
      : [];
  const initialRange = monthRange(month);

  return (
    <div className="portal-shell">
      <header className="portal-header">
        <div className="portal-header-left">
          <Link href="/portal/player" className="portal-header-logo-link" aria-label="PCU Home">
            <img src="/pitching-coach-u-logo.png" alt="PCU logo" className="portal-header-logo" />
          </Link>
          {session.role === 'admin' || session.role === 'coach' ? (
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
          ) : null}
        </div>
        <div className="portal-header-center">
          <nav className="portal-nav" aria-label="Portal Navigation">
            {(session.role === 'admin' || session.role === 'coach') && (
              <Link href="/portal/admin" className="portal-nav-link">
                Admin
              </Link>
            )}
            <Link
              href={
                session.role === 'admin' || session.role === 'coach'
                  ? `/portal/player?previewPlayerId=${effectivePlayerId}`
                  : '/portal/player'
              }
              className="portal-nav-link"
            >
              Profile
            </Link>
            <Link href="/portal/player/program" className="portal-nav-link active">
              Program
            </Link>
            {session.role === 'player' ? (
              <Link href="/portal/dashboard" className="portal-nav-link">
                PCU Dashboard
              </Link>
            ) : (
              <Link href="/tutorials" className="portal-nav-link">
                Tutorials
              </Link>
            )}
          </nav>
          <MobileNavSelect
            currentHref="/portal/player/program"
            loggedInAs={session.name ?? session.email}
            items={[
              ...(session.role === 'admin' || session.role === 'coach' ? [{ href: '/portal/admin', label: 'Admin' }] : []),
              {
                href:
                  session.role === 'admin' || session.role === 'coach'
                    ? `/portal/player?previewPlayerId=${effectivePlayerId}`
                    : '/portal/player',
                label: 'Profile',
              },
              { href: '/portal/player/program', label: 'Program' },
              ...(session.role === 'player'
                ? [{ href: '/portal/dashboard', label: 'PCU Dashboard' }]
                : [{ href: '/tutorials', label: 'Tutorials' }]),
            ]}
          />
        </div>
        <div className="portal-header-right">
          <div className="portal-user-meta" aria-label="Logged in user">
            <p>{session.role === 'admin' || session.role === 'coach' ? 'Previewing' : 'Logged In As'}</p>
            <h1>{session.role === 'admin' || session.role === 'coach' ? player.fullName : session.name ?? session.email}</h1>
          </div>
          <LogoutButton />
          <div className="portal-social-row" aria-label="PCU Social Links">
            <Link href="https://x.com/pitchingcoachu" target="_blank" rel="noopener noreferrer" className="social-link" aria-label="PCU on X">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M18.244 2H21l-6.528 7.462L22.148 22h-6.012l-4.708-6.163L6.035 22H3.277l6.983-7.979L2 2h6.166l4.255 5.617L18.244 2Zm-2.108 18h1.58L7.308 3.896H5.612L16.136 20Z" />
              </svg>
            </Link>
            <Link href="https://instagram.com/pitchingcoachu" target="_blank" rel="noopener noreferrer" className="social-link" aria-label="PCU on Instagram">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7.75 2h8.5A5.75 5.75 0 0 1 22 7.75v8.5A5.75 5.75 0 0 1 16.25 22h-8.5A5.75 5.75 0 0 1 2 16.25v-8.5A5.75 5.75 0 0 1 7.75 2Zm0 1.75A4 4 0 0 0 3.75 7.75v8.5a4 4 0 0 0 4 4h8.5a4 4 0 0 0 4-4v-8.5a4 4 0 0 0-4-4h-8.5Zm9.063 1.312a1.188 1.188 0 1 1 0 2.375 1.188 1.188 0 0 1 0-2.375ZM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 1.75a3.25 3.25 0 1 0 0 6.5 3.25 3.25 0 0 0 0-6.5Z" />
              </svg>
            </Link>
            <Link href="https://youtube.com/@pitchingcoachu?si=rstmKgKPdnzbLv6q" target="_blank" rel="noopener noreferrer" className="social-link" aria-label="PCU on YouTube">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M23 12s0-3.2-.4-4.6a3 3 0 0 0-2.1-2.1C19 5 12 5 12 5s-7 0-8.5.3a3 3 0 0 0-2.1 2.1C1 8.8 1 12 1 12s0 3.2.4 4.6a3 3 0 0 0 2.1 2.1C5 19 12 19 12 19s7 0 8.5-.3a3 3 0 0 0 2.1-2.1C23 15.2 23 12 23 12ZM10 15.5v-7l6 3.5-6 3.5Z" />
              </svg>
            </Link>
          </div>
        </div>
      </header>

      <section className="portal-panel portal-player-panel">
        <div className="portal-month-header">
          <div>
            <h2>{player.fullName}</h2>
          </div>
          <form method="get" className="portal-month-filter">
            {(session.role === 'admin' || session.role === 'coach') && (
              <input type="hidden" name="previewPlayerId" value={String(effectivePlayerId)} />
            )}
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
