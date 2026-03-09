import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requirePortalSession } from '../../lib/portal-session';
import DashboardSelector from './dashboard-selector';
import LogoutButton from './logout-button';

type PortalPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const DEFAULT_DASHBOARD_URL = 'https://pitchingcoachu.shinyapps.io/TMdata/';

function slugifyAppName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export default async function PortalPage({ searchParams }: PortalPageProps) {
  const session = await requirePortalSession();
  const params = await searchParams;

  if (session.role === 'player') {
    redirect('/portal/player');
  }
  const apps = [{ name: 'Dashboard', url: DEFAULT_DASHBOARD_URL }];
  const appId = typeof params.app === 'string' ? params.app : '';
  const appsWithId = apps.map((app, index) => ({
    ...app,
    id: `${slugifyAppName(app.name) || 'dashboard'}-${index + 1}`,
  }));
  const activeApp = appsWithId.find((app) => app.id === appId) ?? (appsWithId.length === 1 ? appsWithId[0] : null);

  return (
    <div className="portal-shell">
      <header className="portal-header">
        <div className="portal-header-left">
          <DashboardSelector apps={appsWithId.map((app) => ({ id: app.id, name: app.name }))} selectedAppId={activeApp?.id} />
        </div>
        <div className="portal-header-center">
          <nav className="portal-nav" aria-label="Portal Navigation">
            <Link href="/portal" className="portal-nav-link active">
              Dashboard
            </Link>
            <Link href="/portal/admin" className="portal-nav-link">
              Admin
            </Link>
            <Link href="/portal/player?preview=self" className="portal-nav-link">
              Player View
            </Link>
            <Link href="/tutorials" className="portal-nav-link">
              Tutorials
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
      <section className="portal-frame-wrap">
        {activeApp ? (
          <iframe
            src={activeApp.url}
            title="PCU Dashboard App"
            className="portal-frame"
            allow="fullscreen"
            loading="lazy"
          />
        ) : (
          <div className="portal-empty-state">
            <h2>Select Dashboard</h2>
            <p>Choose a school dashboard from the dropdown in the top left.</p>
          </div>
        )}
      </section>
    </div>
  );
}
