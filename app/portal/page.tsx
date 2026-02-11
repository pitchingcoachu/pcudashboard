import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionFromCookies } from '../../lib/auth';
import LogoutButton from './logout-button';

type PortalPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function slugifyAppName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export default async function PortalPage({ searchParams }: PortalPageProps) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  const params = await searchParams;

  if (!session) {
    redirect('/login');
  }
  const apps = session.apps.length > 0 ? session.apps : [{ name: 'Dashboard', url: session.appUrl }];
  const appId = typeof params.app === 'string' ? params.app : '';
  const appsWithId = apps.map((app, index) => ({
    ...app,
    id: `${slugifyAppName(app.name) || 'dashboard'}-${index + 1}`,
  }));
  const activeApp =
    appsWithId.find((app) => app.id === appId) ??
    appsWithId.find((app) => app.url === session.appUrl) ??
    appsWithId[0];

  return (
    <div className="portal-shell">
      <header className="portal-header">
        <div>
          <p className="hero-eyebrow">Logged In As</p>
          <h1>{session.name ?? session.email}</h1>
        </div>
        <nav className="portal-nav" aria-label="Portal Navigation">
          <Link href="/portal" className="portal-nav-link active">
            Dashboard
          </Link>
          <Link href="/tutorials" className="portal-nav-link">
            Tutorials
          </Link>
        </nav>
        <details className="portal-app-dropdown">
          <summary className="portal-app-summary" aria-label="Select dashboard app">
            <span className="portal-app-current">{activeApp.name}</span>
          </summary>
          <div className="portal-app-menu" role="menu" aria-label="App Selection">
            {appsWithId.map((app) => {
              const isActive = app.id === activeApp.id;
              return (
                <Link
                  key={app.id}
                  href={`/portal?app=${encodeURIComponent(app.id)}`}
                  className={`portal-app-option${isActive ? ' active' : ''}`}
                >
                  {app.name}
                </Link>
              );
            })}
          </div>
        </details>
        <LogoutButton />
      </header>
      <section className="portal-frame-wrap">
        <iframe
          src={activeApp.url}
          title="PCU Dashboard App"
          className="portal-frame"
          allow="fullscreen"
          loading="lazy"
        />
      </section>
    </div>
  );
}
