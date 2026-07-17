import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requirePortalSession } from '../../../lib/portal-session';
import { resolveDashboardSchoolCode } from '../../../lib/dashboard-access';
import { canUseClientManagement, canUseProgrammingData, getSchoolProductAccess } from '../../../lib/programming-scope';
import { resolveSchoolBrand, schoolBrandCssVars } from '../../../lib/school-brand';
import MobileNavSelect from '../mobile-nav-select';
import LogoutButton from '../logout-button';
import DashboardSchoolSelector from '../dashboard/dashboard-school-selector';
import PortalNotificationsBell from '../notifications-bell';
import PortalThemeToggle from '../theme-toggle';
import { resolveSessionDashboardSchoolOptions } from '../../../lib/dashboard-school-options';

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeoutPromise = new Promise<T>((resolve) => {
      timeout = setTimeout(() => resolve(fallback), timeoutMs);
    });
    return await Promise.race([promise, timeoutPromise]);
  } catch {
    return fallback;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePortalSession();
  const selectedSchool = resolveDashboardSchoolCode(session);
  const schoolOptions = await withTimeout(resolveSessionDashboardSchoolOptions(session), 3_000, [selectedSchool, 'LEAGUE', 'PRO']);
  const brand = resolveSchoolBrand(selectedSchool);
  const schoolAccess =
    session.role === 'admin'
      ? await withTimeout(
          getSchoolProductAccess(selectedSchool),
          3_000,
          { dashboard: true, programming: canUseProgrammingData(session), clientManagement: canUseClientManagement(session) }
        )
      : null;
  const canAccessProgramming = session.role === 'admin' ? schoolAccess?.programming === true : canUseProgrammingData(session);
  const canAccessClientManagement = session.role === 'admin' ? schoolAccess?.clientManagement !== false : canUseClientManagement(session);
  const isProSchool = String(selectedSchool).trim().toUpperCase() === 'PRO';
  const showCoachClientTabs = canAccessClientManagement && !(session.role === 'coach' && isProSchool);
  const useCompactProgrammingNav = canAccessProgramming;

  if (session.role === 'player') {
    redirect('/portal/player');
  }

  return (
    <div className={`portal-shell${isProSchool ? ' portal-shell--pro' : ''}`} style={schoolBrandCssVars(selectedSchool)}>
      <header className="portal-header">
        <div className="portal-header-left">
          {session.role === 'admin' || session.role === 'coach' ? (
            <DashboardSchoolSelector options={schoolOptions} initialValue={selectedSchool} logoOnly />
          ) : (
            <Link href="/portal/admin" className="portal-header-logo-link" aria-label={`${brand.schoolCode} Home`}>
              <img
                src={brand.logoSrc ?? '/pitching-coach-u-logo.png'}
                alt={brand.logoSrc ? brand.logoAlt : 'PCU logo'}
                className={`portal-header-logo${brand.logoSrc ? ' portal-header-logo--school' : ''}`}
              />
            </Link>
          )}
        </div>
        <div className="portal-header-center">
          <div className="portal-header-nav-stack">
            <nav className="portal-nav" aria-label="Portal Navigation">
              {useCompactProgrammingNav ? (
                <>
                  <Link href="/portal/admin" className="portal-nav-link">
                    Home
                  </Link>
                  <Link href="/portal/dashboard" className="portal-nav-link">
                    Dashboard
                  </Link>
                  <Link href="/portal/admin/schedule" className="portal-nav-link">
                    Schedule
                  </Link>
                  <Link href="/profiles" className="portal-nav-link">
                    Profiles
                  </Link>
                  <Link href="/portal/admin/questionnaires" className="portal-nav-link">
                    Questionnaires
                  </Link>
                </>
              ) : (
                <>
                  <Link href="/portal/admin" className="portal-nav-link">
                    Home
                  </Link>
                  {(session.role === 'admin' || session.role === 'coach') && showCoachClientTabs && (
                    <Link href="/portal/admin/clients" className="portal-nav-link">
                      Players
                    </Link>
                  )}
                  {session.role === 'admin' && showCoachClientTabs && (
                    <Link href="/portal/admin/coaches" className="portal-nav-link">
                      Coaches
                    </Link>
                  )}
                  <Link href="/portal/dashboard" className="portal-nav-link">
                    Dashboard
                  </Link>
                </>
              )}
            </nav>
          </div>
          <MobileNavSelect
            loggedInAs={session.name ?? session.email}
            items={
              useCompactProgrammingNav
                ? [
                    { href: '/portal/admin', label: 'Home' },
                    { href: '/portal/dashboard', label: 'Dashboard' },
                    { href: '/portal/admin/schedule', label: 'Schedule' },
                    { href: '/profiles', label: 'Profiles' },
                    { href: '/portal/admin/questionnaires', label: 'Questionnaires' },
                  ]
                : [
                    { href: '/portal/admin', label: 'Home' },
                    ...(session.role === 'admin' || session.role === 'coach'
                      ? [...(showCoachClientTabs ? [{ href: '/portal/admin/clients', label: 'Players' }] : [])]
                      : []),
                    ...(session.role === 'admin' && showCoachClientTabs ? [{ href: '/portal/admin/coaches', label: 'Coaches' }] : []),
                    { href: '/portal/dashboard', label: 'Dashboard' },
                  ]
            }
          />
        </div>
        <div className="portal-header-right">
          <div className="portal-user-meta" aria-label="Logged in user">
            <p>Logged In As</p>
            <h1>{session.name ?? session.email}</h1>
          </div>
          <PortalNotificationsBell />
          <LogoutButton />
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
          <Link href="/portal/dashboard" className="portal-header-logo-link" aria-label="PCU Home">
            <img src="/pitching-coach-u-logo.png" alt="PCU logo" className="portal-header-logo portal-header-logo--pcu-right" />
          </Link>
        </div>
      </header>
      <section className="portal-panel portal-admin-panel">{children}</section>
    </div>
  );
}
