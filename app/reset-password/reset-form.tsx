'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';

type ResetFormProps = {
  token: string;
};

export default function ResetForm({ token }: ResetFormProps) {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setMessage('');

    if (!token) {
      setError('Missing reset token. Please use the link from your email.');
      return;
    }

    const formData = new FormData(event.currentTarget);
    const password = String(formData.get('password') ?? '');
    const confirmPassword = String(formData.get('confirm_password') ?? '');

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });

      if (!response.ok) {
        const json = (await response.json()) as { error?: string };
        setError(json.error ?? 'Could not reset password.');
        return;
      }

      setMessage('Password updated. You can now log in with your new password.');
      event.currentTarget.reset();
    } catch {
      setError('Could not reset password. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="auth-shell">
      <section className="auth-card">
        <p className="hero-eyebrow">PCU Dashboard Access</p>
        <h1>Reset Password</h1>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label>
            New Password
            <input type="password" name="password" autoComplete="new-password" minLength={8} required />
          </label>
          <label>
            Confirm New Password
            <input type="password" name="confirm_password" autoComplete="new-password" minLength={8} required />
          </label>
          <button type="submit" className="btn btn-primary">
            {isSubmitting ? 'Saving...' : 'Set New Password'}
          </button>
          {message && <p className="auth-message">{message}</p>}
          {error && <p className="auth-error">{error}</p>}
        </form>
        <Link href="/login" className="btn btn-ghost as-link">
          Back to Login
        </Link>
      </section>
    </div>
  );
}
