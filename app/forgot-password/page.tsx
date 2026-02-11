'use client';

import Link from 'next/link';
import { FormEvent, useRef, useState } from 'react';

export default function ForgotPasswordPage() {
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitLockRef = useRef(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    setMessage('');
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get('email') ?? '');

    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      // Always show the same response message to avoid mixed UI states and
      // avoid revealing account existence details.
      setMessage('If that email exists, a reset link has been sent.');
      event.currentTarget.reset();
    } catch {
      setMessage('If that email exists, a reset link has been sent.');
    } finally {
      setIsSubmitting(false);
      submitLockRef.current = false;
    }
  };

  return (
    <div className="auth-shell">
      <section className="auth-card">
        <p className="hero-eyebrow">PCU Dashboard Access</p>
        <h1>Forgot Password</h1>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label>
            Email
            <input type="email" name="email" autoComplete="email" required />
          </label>
          <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
            {isSubmitting ? 'Sending...' : 'Send Reset Link'}
          </button>
          {message && <p className="auth-message">{message}</p>}
        </form>
        <Link href="/login" className="btn btn-ghost as-link">
          Back to Login
        </Link>
      </section>
    </div>
  );
}
