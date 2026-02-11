import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE_NAME, verifySessionToken } from '../../lib/auth';
import LogoutButton from './logout-button';

export default async function PortalPage() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = sessionToken ? verifySessionToken(sessionToken) : null;

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
