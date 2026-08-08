import Link from 'next/link';
import { requirePortalSession } from '../../../lib/portal-session';
import MobileNavSelect from '../mobile-nav-select';
import LogoutButton from '../logout-button';
import PortalUserMenu from '../user-menu';
import { resolveDashboardSchoolCode } from '../../../lib/dashboard-access';
import { canUseDashboardData, canUseProgrammingData } from '../../../lib/programming-scope';
import { schoolBrandCssVars } from '../../../lib/school-brand';
import DashboardSchoolSelector from './dashboard-school-selector';
import DashboardShell from './dashboard-shell';
import { resolveSessionDashboardSchoolOptions } from '../../../lib/dashboard-school-options';
import PortalThemeToggle from '../theme-toggle';
import PortalNotificationsBell from '../notifications-bell';
import PortalMessagesNavButton from '../messages-nav-button';

type PortalDashboardPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type DashboardSuiteName =
  | 'Home'
  | 'Pitching'
  | 'Hitting'
  | 'Catching'
  | 'Custom Reports'
  | 'Comparison Tool'
  | 'Biomechanics'
  | 'Player Plans'
  | 'Player Notes'
  | 'Stuff+ Calculator';

const SUITE_SLUG_MAP: Record<string, DashboardSuiteName> = {
  home: 'Home',
  pitching: 'Pitching',
  'pitching-suite': 'Pitching',
  hitting: 'Hitting',
  'hitting-suite': 'Hitting',
  catching: 'Catching',
  'catching-suite': 'Catching',
  'custom-reports': 'Custom Reports',
  'custom_reports': 'Custom Reports',
  'custom reports': 'Custom Reports',
  'comparison-tool': 'Comparison Tool',
  'comparison_tool': 'Comparison Tool',
  'comparison tool': 'Comparison Tool',
  biomechanics: 'Biomechanics',
  'player-plans': 'Player Plans',
  player_plans: 'Player Plans',
  'player plans': 'Player Plans',
  'player-notes': 'Player Notes',
  player_notes: 'Player Notes',
  'player notes': 'Player Notes',
  'stuff-calculator': 'Stuff+ Calculator',
  stuff_calculator: 'Stuff+ Calculator',
  'stuff+ calculator': 'Stuff+ Calculator',
};

function readSuiteParam(
  value: string | string[] | undefined
): DashboardSuiteName | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const normalized = String(raw ?? '').trim().toLowerCase();
  if (!normalized) return null;
  return SUITE_SLUG_MAP[normalized] ?? null;
}

export default async function PortalDashboardPage({ searchParams }: PortalDashboardPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const forceHome =
    (Array.isArray(resolvedSearchParams.home)
      ? resolvedSearchParams.home[0]
      : resolvedSearchParams.home) === '1';
  const initialSuite = readSuiteParam(resolvedSearchParams.suite);
  const session = await requirePortalSession();
  const schoolOptions = await resolveSessionDashboardSchoolOptions(session);
  const selectedSchool = resolveDashboardSchoolCode(session);
  const canAccessDashboard = await canUseDashboardData(session);
  const canAccessProgramming = await canUseProgrammingData(session);

  const isProSchool = String(selectedSchool ?? '').trim().toUpperCase() === 'PRO';

  return (
    <div className={`portal-shell${isProSchool ? ' portal-shell--pro' : ''}`} style={schoolBrandCssVars(selectedSchool)}>
      <header className="portal-header">
        <div className="portal-header-left">
          <DashboardSchoolSelector options={schoolOptions} initialValue={selectedSchool} logoOnly />
        </div>
        <div className="portal-header-center">
          <div className="portal-header-nav-stack">
            <nav className="portal-nav" aria-label="Portal Navigation">
              {(session.role === 'admin' || session.role === 'coach') && (
                <Link href="/portal/admin" className="portal-nav-link">
                  Home
                </Link>
              )}
              {session.role === 'player' ? (
                <>
                  {canAccessProgramming ? (
                    <>
                      <Link href="/portal/player" className="portal-nav-link">
                        Profile
                      </Link>
                      <Link href="/portal/player/program" className="portal-nav-link">
                        Program
                      </Link>
                    </>
                  ) : null}
                </>
              ) : (
                canAccessProgramming ? (
                  <Link href="/portal/admin/schedule" className="portal-nav-link">
                    Schedule
                  </Link>
                ) : null
              )}
              <Link href="/portal/dashboard" className="portal-nav-link active">
                Dashboard
              </Link>
              {(session.role === 'admin' || session.role === 'coach') && (
                <Link href="/profiles" className="portal-nav-link">
                  Profiles
                </Link>
              )}
            </nav>
          </div>
          <MobileNavSelect
            currentHref="/portal/dashboard"
            loggedInAs={session.name ?? session.email}
            items={[
              ...(session.role === 'admin' || session.role === 'coach' ? [{ href: '/portal/admin', label: 'Home' }] : []),
              ...(session.role === 'player'
                ? [...(canAccessProgramming ? [{ href: '/portal/player', label: 'Profile' }, { href: '/portal/player/program', label: 'Program' }] : [])]
                : [...(canAccessProgramming ? [{ href: '/portal/admin/schedule', label: 'Schedule' }] : [])]),
              { href: '/portal/dashboard', label: 'Dashboard' },
              ...(session.role === 'admin' || session.role === 'coach' ? [{ href: '/profiles', label: 'Profiles' }] : []),
            ]}
          />
        </div>
        <div className="portal-header-right">
          {session.role === 'admin' || session.role === 'coach' ? (
            <PortalUserMenu displayName={session.name ?? session.email} />
          ) : (
            <div className="portal-user-meta" aria-label="Logged in user">
              <p>Logged In As</p>
              <h1>{session.name ?? session.email}</h1>
            </div>
          )}
          <PortalMessagesNavButton />
          <PortalNotificationsBell />
          {session.role === 'player' ? <LogoutButton /> : null}
          <PortalThemeToggle />
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
          <Link href="/portal/dashboard" className="portal-header-logo-link" aria-label="Pearl home">
            <img src="/pearl-clam-transparent.png" alt="Pearl Player Development" className="portal-header-logo portal-header-logo--pcu-right" />
          </Link>
        </div>
      </header>

      {canAccessDashboard ? (
        <DashboardShell
          key={`dashboard-shell-${selectedSchool}`}
          role={session.role}
          selectedSchoolCode={selectedSchool}
          forceHome={forceHome}
          initialSuite={initialSuite}
        />
      ) : (
        <section className="portal-panel">
          <h2>Dashboard Access</h2>
          <p>Dashboard access is not enabled for the selected school.</p>
        </section>
      )}
    </div>
  );
}
