import Image from 'next/image';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSessionFromCookies } from '../../lib/auth';
import pearlLockup from '../../pearl/pearl-lockup-transparent.png';

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
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (session) {
    redirect('/portal');
  }

  const params = await searchParams;
  const error = typeof params.error === 'string' ? getErrorMessage(params.error) : '';

  return (
    <div className="auth-shell pearl-auth-shell">
      <div className="pearl-auth-glow pearl-auth-glow--cyan" aria-hidden="true" />
      <div className="pearl-auth-glow pearl-auth-glow--violet" aria-hidden="true" />

      <main className="pearl-auth-layout">
        <section className="pearl-auth-brand" aria-label="Pearl Player Development">
          <Link href="/" className="pearl-auth-lockup-link" aria-label="Pearl Player Development home">
            <span className="pearl-auth-lockup">
              <Image
                src={pearlLockup}
                alt="Pearl Player Development"
                fill
                sizes="(max-width: 820px) 90vw, 48vw"
                priority
                className="pearl-auth-lockup-image"
              />
            </span>
          </Link>
          <div className="pearl-auth-brand-copy">
            <p className="pearl-auth-kicker">
              <strong><em>The</em></strong> player development hub for baseball coaches and programs.
            </p>
          </div>
          <div className="pearl-auth-signal" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
        </section>

        <section className="auth-card pearl-auth-card">
          <div className="pearl-auth-card-heading">
            <p className="hero-eyebrow">Pearl Player Development</p>
            <h1>Welcome back.</h1>
            <p>Log in to continue to your player development hub.</p>
          </div>
          <form className="auth-form pearl-auth-form" method="post" action="/api/auth/login?mode=web">
            <label>
              Email
              <input
                type="email"
                name="email"
                autoComplete="email"
                placeholder="you@yourprogram.com"
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                placeholder="Enter your password"
                required
              />
            </label>
            <button type="submit" className="btn btn-primary pearl-auth-submit">
              Log In
            </button>
            {error ? (
              <p className="auth-error" role="alert">
                {error}
              </p>
            ) : null}
            <Link href="/forgot-password" className="auth-link">
              Forgot password?
            </Link>
          </form>
          <div className="pearl-auth-card-footer">
            <span>Secure access for Pearl partners</span>
            <Link href="/">Back to home</Link>
          </div>
        </section>
      </main>
    </div>
  );
}
