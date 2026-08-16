import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import SyncForcePlatesButton from './sync-force-plates-button';
import { requirePortalSession } from '../../../lib/portal-session';
import { resolveDashboardSchoolCode } from '../../../lib/dashboard-access';
import { resolveSessionDashboardSchoolOptions } from '../../../lib/dashboard-school-options';
import { canUseProgrammingData, resolveProgrammingOrganizationId, resolveProgrammingSchoolCode } from '../../../lib/programming-scope';
import { getPlayerForUser, listPlayerChoicesByOrganization } from '../../../lib/training-db';
import { loadForcePlateSnapshot } from '../../../lib/force-plate-cache-db';
import { loadForcePlateSnapshotFromNeon } from '../../../lib/force-plate-neon-db';
import type { ValdSnapshot } from '../../../lib/vald-forceplates';
import ForcePlatesDashboard from './force-plates-dashboard';
import PortalChrome from '../portal-chrome';
import LogoutButton from '../logout-button';
import PortalUserMenu from '../user-menu';
import DashboardSchoolSelector from '../dashboard/dashboard-school-selector';
import PortalNotificationsBell from '../notifications-bell';
import PortalThemeToggle from '../theme-toggle';
import PortalMessagesNavButton from '../messages-nav-button';

function normalizeName(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/[^a-z0-9]+/g, '');
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
  if (String(selectedSchoolCode ?? '').trim().toUpperCase() === 'TRIAL') notFound();
  const canAccessProgramming = await canUseProgrammingData(session);
  const orgId = await resolveProgrammingOrganizationId(session);
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
  let snapshot: ValdSnapshot | null = null;
  let availablePlayers: string[] = [];
  if (!isPcu) {
    error = 'Force Plate Data is currently enabled only for PCU.';
  } else if (!canAccessProgramming) {
    error = 'Programming access is required to view Force Plate Data.';
  } else if (candidateNames.length === 0) {
    error = 'No PCU players found in programming list.';
  } else {
    try {
      const fromNeon = await loadForcePlateSnapshotFromNeon({
        organizationId: orgId,
        schoolCode: selectedSchoolCode,
        allowedPlayerNames: candidateNames,
      });
      const cached = fromNeon.snapshot
        ? { snapshot: fromNeon.snapshot }
        : await loadForcePlateSnapshot({ organizationId: orgId, schoolCode: selectedSchoolCode });
      if (!cached.snapshot) throw new Error('Force plate cache is empty. Ask an admin to run Force Plate Sync.');
      const fullSnapshot = cached.snapshot;
      availablePlayers = fullSnapshot.players
        .filter((player) => player.testsCount > 0 || player.metricRows.length > 0 || player.recentTests.length > 0)
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
            players: fullSnapshot.players,
          };
        }
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load ForceDecks data.';
    }
  }

  return (
    <PortalChrome
      left={<DashboardSchoolSelector options={schoolOptions} initialValue={selectedSchool} logoOnly />}
      navLinks={
        <>
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
        </>
      }
      mobileNavCurrentHref="/portal/force-plates"
      mobileNavLoggedInAs={session.name ?? session.email}
      mobileNavItems={[
        ...(session.role === 'admin' || session.role === 'coach' ? [{ href: '/portal/admin', label: 'Home' }] : []),
        ...(session.role === 'player' && canAccessProgramming
          ? [
              { href: '/portal/player', label: 'Profile' },
              { href: '/portal/player/program', label: 'Program' },
            ]
          : []),
        { href: '/portal/dashboard', label: 'Dashboard' },
      ]}
      right={
        <>
          {session.role === 'admin' || session.role === 'coach' ? (
            <PortalUserMenu displayName={session.name ?? session.email} />
          ) : (
            <div className="portal-user-meta" aria-label="Logged in user">
              <p>Logged In As</p>
              <h1>{session.name ?? session.email}</h1>
            </div>
          )}
          <PortalMessagesNavButton />
          {(session.role === 'admin' || session.role === 'coach') ? <PortalNotificationsBell /> : null}
          {session.role === 'player' ? <LogoutButton /> : null}
          <PortalThemeToggle />
        </>
      }
      sectionClassName="portal-panel portal-admin-panel"
    >
      <div className="portal-admin-stack">
        <div className="portal-admin-headline" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <h2 style={{ margin: 0 }}>VALD Force Plate Data</h2>
            {session.role !== 'player' ? <SyncForcePlatesButton /> : null}
          </div>
          <div style={{ position: 'relative', width: '220px', height: '56px', overflow: 'hidden', flexShrink: 0 }}>
            <Image src="/vald.webp" alt="VALD" fill style={{ objectFit: 'cover', objectPosition: 'center' }} />
          </div>
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
    </PortalChrome>
  );
}
