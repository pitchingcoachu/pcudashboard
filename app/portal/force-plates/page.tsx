import Link from 'next/link';
import { requirePortalSession } from '../../../lib/portal-session';
import { resolveDashboardSchoolCode } from '../../../lib/dashboard-access';
import { resolveSessionDashboardSchoolOptions } from '../../../lib/dashboard-school-options';
import { canUseProgrammingData, resolveProgrammingOrganizationId, resolveProgrammingSchoolCode } from '../../../lib/programming-scope';
import { getPlayerForUser, listPlayerChoicesByOrganization } from '../../../lib/training-db';
import { fetchValdForceDecksSnapshot } from '../../../lib/vald-forceplates';
import ForcePlatesDashboard from './force-plates-dashboard';
import MobileNavSelect from '../mobile-nav-select';
import LogoutButton from '../logout-button';
import DashboardSchoolSelector from '../dashboard/dashboard-school-selector';
import PortalThemeToggle from '../theme-toggle';

function normalizeName(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function toFirstLast(value: string): string {
  const raw = String(value ?? '').trim();
  if (!raw.includes(',')) return raw;
  const [last, ...rest] = raw.split(',').map((x) => x.trim());
  const first = rest.join(' ').trim();
  return first && last ? `${first} ${last}` : raw;
}

function sparklinePath(values: number[]): string {
  if (values.length === 0) return '';
  if (values.length === 1) return 'M 0 20 L 100 20';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(0.00001, max - min);
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 100;
      const y = 40 - ((value - min) / range) * 34;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
}

function formatShortDateTime(value: string): string {
  const parsed = new Date(String(value ?? '').trim());
  if (Number.isNaN(parsed.getTime())) return String(value ?? '');
  const month = parsed.getUTCMonth() + 1;
  const day = parsed.getUTCDate();
  const year = String(parsed.getUTCFullYear() % 100).padStart(2, '0');
  const hour = String(parsed.getUTCHours()).padStart(2, '0');
  const minute = String(parsed.getUTCMinutes()).padStart(2, '0');
  return `${month}/${day}/${year} ${hour}:${minute} UTC`;
}

export default async function ForcePlatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requirePortalSession();
  const selectedSchool = resolveDashboardSchoolCode(session);
  const schoolOptions = await resolveSessionDashboardSchoolOptions(session);
  const params = await searchParams;
  const selectedSchoolCode = resolveProgrammingSchoolCode(session);
  const canAccessProgramming = canUseProgrammingData(session);
  const orgId = resolveProgrammingOrganizationId(session);
  const isPcu = String(selectedSchoolCode ?? '').trim().toUpperCase() === 'PCU';

  const playerQueryRaw = Array.isArray(params.player) ? params.player[0] : params.player;
  const requestedPlayer = String(playerQueryRaw ?? '').trim();

  let playerScopedName = '';
  if (session.role === 'player') {
    const own = await getPlayerForUser({ organizationId: orgId, userId: session.userId ?? 0 });
    playerScopedName = toFirstLast(String(own?.fullName ?? '')).trim();
  }

  const pcuCandidates =
    isPcu && canAccessProgramming && orgId > 0
      ? await listPlayerChoicesByOrganization({
          organizationId: orgId,
          assignedCoachUserId: session.role === 'coach' ? (session.userId ?? 0) : null,
        })
      : [];
  const candidateNames = Array.from(
    new Set(
      pcuCandidates
        .map((player) => toFirstLast(String(player.fullName ?? '').trim()))
        .filter(Boolean)
    )
  );
  const allowedSet = new Set(candidateNames.map(normalizeName));

  let selectedPlayers: string[] = [];
  if (session.role === 'player') {
    if (playerScopedName && allowedSet.has(normalizeName(playerScopedName))) selectedPlayers = [playerScopedName];
  } else if (requestedPlayer && requestedPlayer !== 'All') {
    selectedPlayers = candidateNames.filter((name) => normalizeName(name) === normalizeName(requestedPlayer));
  } else {
    selectedPlayers = candidateNames;
  }

  let error = '';
  let snapshot: Awaited<ReturnType<typeof fetchValdForceDecksSnapshot>> | null = null;
  let availablePlayers: string[] = [];
  if (!isPcu) {
    error = 'Force Plate Data is currently enabled only for PCU.';
  } else if (!canAccessProgramming) {
    error = 'Programming access is required to view Force Plate Data.';
  } else if (candidateNames.length === 0) {
    error = 'No PCU players found in programming list.';
  } else {
    try {
      const fullSnapshot = await fetchValdForceDecksSnapshot(candidateNames);
      availablePlayers = fullSnapshot.players
        .filter((player) => Boolean(player.profileId) && player.testsCount > 0)
        .map((player) => player.playerName);
      const availableSet = new Set(availablePlayers.map(normalizeName));
      if (session.role === 'player') {
        const selfAllowed = playerScopedName && availableSet.has(normalizeName(playerScopedName));
        if (!selfAllowed) {
          error = 'No force plate data is available for your profile yet.';
        } else {
          snapshot = {
            ...fullSnapshot,
            players: fullSnapshot.players.filter((player) => normalizeName(player.playerName) === normalizeName(playerScopedName)),
          };
        }
      } else {
        if (!availablePlayers.length) {
          error = 'No PCU players with force plate data were found.';
        } else {
          snapshot = {
            ...fullSnapshot,
            players: fullSnapshot.players.filter((player) => availableSet.has(normalizeName(player.playerName))),
          };
        }
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load ForceDecks data.';
    }
  }

  return (
    <div className="portal-shell">
      <header className="portal-header">
        <div className="portal-header-left">
          <DashboardSchoolSelector options={schoolOptions} initialValue={selectedSchool} logoOnly />
        </div>
        <div className="portal-header-center">
          <nav className="portal-nav" aria-label="Portal Navigation">
            {(session.role === 'admin' || session.role === 'coach') && (
              <Link href="/portal/admin" className="portal-nav-link">
                Home
              </Link>
            )}
            {session.role === 'player' && canAccessProgramming ? (
              <>
                <Link href="/portal/player" className="portal-nav-link">
                  Profile
                </Link>
                <Link href="/portal/player/program" className="portal-nav-link">
                  Program
                </Link>
              </>
            ) : null}
            <Link href="/portal/dashboard" className="portal-nav-link">
              Dashboard
            </Link>
            <Link href="/portal/force-plates" className="portal-nav-link active">
              Force Plates
            </Link>
          </nav>
          <MobileNavSelect
            currentHref="/portal/force-plates"
            loggedInAs={session.name ?? session.email}
            items={[
              ...(session.role === 'admin' || session.role === 'coach' ? [{ href: '/portal/admin', label: 'Home' }] : []),
              ...(session.role === 'player' && canAccessProgramming
                ? [
                    { href: '/portal/player', label: 'Profile' },
                    { href: '/portal/player/program', label: 'Program' },
                  ]
                : []),
              { href: '/portal/dashboard', label: 'Dashboard' },
              { href: '/portal/force-plates', label: 'Force Plates' },
            ]}
          />
        </div>
        <div className="portal-header-right">
          <div className="portal-user-meta" aria-label="Logged in user">
            <p>Logged In As</p>
            <h1>{session.name ?? session.email}</h1>
          </div>
          <LogoutButton />
          <PortalThemeToggle />
        </div>
      </header>

      <section className="portal-panel portal-admin-panel">
        <div className="portal-admin-stack">
          <div className="portal-admin-headline">
            <h2>Force Plate Data</h2>
            <p>Initial VALD ForceDecks integration for PCU. Data source can be expanded to additional schools later.</p>
          </div>
          {error ? (
            <article className="portal-admin-card">
              <p className="auth-error" style={{ margin: 0 }}>
                {error}
              </p>
            </article>
          ) : null}

          {snapshot ? (
            <>
              <ForcePlatesDashboard snapshot={snapshot} />
              <article className="portal-admin-card">
                <p className="portal-muted-text" style={{ margin: 0 }}>
                  Last sync: {formatShortDateTime(snapshot.fetchedAt)}
                </p>
              </article>
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}
