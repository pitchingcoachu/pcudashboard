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
