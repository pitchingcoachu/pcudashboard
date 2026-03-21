'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type Props = {
  schoolCode: string;
  initialAccess: {
    dashboard: boolean;
    programming: boolean;
    clientManagement: boolean;
  };
};

export default function SchoolAccessCard({ schoolCode, initialAccess }: Props) {
  const router = useRouter();
  const [dashboard, setDashboard] = useState(initialAccess.dashboard);
  const [programming, setProgramming] = useState(initialAccess.programming);
  const [clientManagement, setClientManagement] = useState(initialAccess.clientManagement);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setDashboard(initialAccess.dashboard);
    setProgramming(initialAccess.programming);
    setClientManagement(initialAccess.clientManagement);
  }, [initialAccess.clientManagement, initialAccess.dashboard, initialAccess.programming, schoolCode]);

  async function save() {
    setSaving(true);
    setMessage('');
    try {
      const response = await fetch('/api/admin/school-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schoolCode,
          dashboard,
          programming,
          clientManagement,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to save school access.');
      setMessage('School access updated.');
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to save school access.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="portal-admin-card">
      <h2>School Access</h2>
      <p>{`Selected School: ${schoolCode}`}</p>
      <div className="portal-form-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        <label className="portal-checkbox-label">
          <input type="checkbox" checked={dashboard} onChange={(event) => setDashboard(event.target.checked)} />
          Dashboard
        </label>
        <label className="portal-checkbox-label">
          <input type="checkbox" checked={programming} onChange={(event) => setProgramming(event.target.checked)} />
          Programming
        </label>
        <label className="portal-checkbox-label">
          <input type="checkbox" checked={clientManagement} onChange={(event) => setClientManagement(event.target.checked)} />
          Client/Coach Mgmt
        </label>
      </div>
      <div className="portal-choice-line-actions">
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving}>
          {saving ? 'Saving...' : 'Save Access'}
        </button>
      </div>
      {message ? <p className={message.includes('Failed') ? 'auth-error' : 'auth-message'}>{message}</p> : null}
    </article>
  );
}
