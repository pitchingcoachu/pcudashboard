import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionFromCookies } from '../../lib/auth';
import LogoutButton from './logout-button';

export default async function PortalPage() {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);

  if (!session) {
    redirect('/login');
  }

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
        <LogoutButton />
      </header>
      <section className="portal-frame-wrap">
        <iframe
          src={session.appUrl}
          title="PCU Dashboard App"
          className="portal-frame"
          allow="fullscreen"
          loading="lazy"
        />
      </section>
    </div>
  );
}
