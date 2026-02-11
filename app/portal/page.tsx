import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LEGACY_SESSION_COOKIE_NAMES, SESSION_COOKIE_NAME, verifySessionToken } from '../../lib/auth';
import LogoutButton from './logout-button';

export default async function PortalPage() {
  const cookieStore = await cookies();
  const cookieNames = [SESSION_COOKIE_NAME, ...LEGACY_SESSION_COOKIE_NAMES];
  let session = null;
  for (const cookieName of cookieNames) {
    const token = cookieStore.get(cookieName)?.value;
    if (!token) continue;
    const parsed = verifySessionToken(token);
    if (parsed) {
      session = parsed;
      break;
    }
  }

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
