import Image from 'next/image';
import Link from 'next/link';

type LoginPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function getErrorMessage(errorParam?: string): string {
  if (errorParam === 'invalid') return 'Invalid login. Please check your email and password.';
  if (errorParam === 'missing') return 'Email and password are required.';
  if (errorParam === 'server') return 'Could not log in right now. Please try again.';
  return '';
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const error = typeof params.error === 'string' ? getErrorMessage(params.error) : '';

  return (
    <div className="auth-shell">
      <header className="auth-top-nav">
        <Link href="/" className="portal-header-logo-link" aria-label="PCU Home">
          <Image
            src="/pitching-coach-u-logo.png"
            alt="Pitching Coach U logo"
            width={40}
            height={40}
            priority
            className="portal-header-logo"
          />
        </Link>
        <div className="portal-social-row" aria-label="PCU Social Links">
          <Link
            href="https://x.com/pitchingcoachu"
            target="_blank"
            rel="noopener noreferrer"
            className="social-link"
            aria-label="PCU on X"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18.244 2H21l-6.528 7.462L22.148 22h-6.012l-4.708-6.163L6.035 22H3.277l6.983-7.979L2 2h6.166l4.255 5.617L18.244 2Zm-2.108 18h1.58L7.308 3.896H5.612L16.136 20Z" />
            </svg>
          </Link>
          <Link
            href="https://instagram.com/pitchingcoachu"
            target="_blank"
            rel="noopener noreferrer"
            className="social-link"
            aria-label="PCU on Instagram"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7.75 2h8.5A5.75 5.75 0 0 1 22 7.75v8.5A5.75 5.75 0 0 1 16.25 22h-8.5A5.75 5.75 0 0 1 2 16.25v-8.5A5.75 5.75 0 0 1 7.75 2Zm0 1.75A4 4 0 0 0 3.75 7.75v8.5a4 4 0 0 0 4 4h8.5a4 4 0 0 0 4-4v-8.5a4 4 0 0 0-4-4h-8.5Zm9.063 1.312a1.188 1.188 0 1 1 0 2.375 1.188 1.188 0 0 1 0-2.375ZM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 1.75a3.25 3.25 0 1 0 0 6.5 3.25 3.25 0 0 0 0-6.5Z" />
            </svg>
          </Link>
          <Link
            href="https://youtube.com/@pitchingcoachu?si=rstmKgKPdnzbLv6q"
            target="_blank"
            rel="noopener noreferrer"
            className="social-link"
            aria-label="PCU on YouTube"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M23 12s0-3.2-.4-4.6a3 3 0 0 0-2.1-2.1C19 5 12 5 12 5s-7 0-8.5.3a3 3 0 0 0-2.1 2.1C1 8.8 1 12 1 12s0 3.2.4 4.6a3 3 0 0 0 2.1 2.1C5 19 12 19 12 19s7 0 8.5-.3a3 3 0 0 0 2.1-2.1C23 15.2 23 12 23 12ZM10 15.5v-7l6 3.5-6 3.5Z" />
            </svg>
          </Link>
        </div>
      </header>
      <section className="auth-card">
        <Image
          src="/pitching-coach-u-logo.png"
          alt="Pitching Coach U logo"
          width={64}
          height={64}
          priority
          className="brand-logo"
        />
        <p className="hero-eyebrow">PCU Dashboard Access</p>
        <h1>Log In</h1>
        <form className="auth-form" method="post" action="/api/auth/login?mode=web">
          <label>
            Email
            <input type="email" name="email" autoComplete="email" required />
          </label>
          <label>
            Password
            <input type="password" name="password" autoComplete="current-password" required />
          </label>
          <button type="submit" className="btn btn-primary">
            Log In
          </button>
          {error && <p className="auth-error">{error}</p>}
          <Link href="/forgot-password" className="auth-link">
            Forgot password?
          </Link>
        </form>
        <Link href="/" className="btn btn-ghost as-link">
          Back to Home
        </Link>
      </section>
    </div>
  );
}
