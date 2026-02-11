'use client';

import Image from 'next/image';
import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    const form = event.currentTarget;
    const formData = new FormData(form);

    const payload = {
      email: String(formData.get('email') ?? ''),
      password: String(formData.get('password') ?? ''),
    };

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        setError('Invalid login. Please check your email and password.');
        return;
      }

      router.push('/portal');
      router.refresh();
    } catch {
      setError('Could not log in right now. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

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
        <form className="auth-form" onSubmit={handleSubmit}>
          <label>
            Email
            <input type="email" name="email" autoComplete="email" required />
          </label>
          <label>
            Password
            <input type="password" name="password" autoComplete="current-password" required />
          </label>
          <button type="submit" className="btn btn-primary">
            {isSubmitting ? 'Signing In...' : 'Log In'}
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
