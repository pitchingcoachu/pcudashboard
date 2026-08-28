'use client';

import { useEffect, useState } from 'react';

export default function NotificationsCard() {
  const [receivePlayerNoteEmails, setReceivePlayerNoteEmails] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/portal/settings', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { receivePlayerNoteEmails?: boolean } | null) => {
        if (!cancelled && payload) setReceivePlayerNoteEmails(payload.receivePlayerNoteEmails !== false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = async (next: boolean) => {
    setReceivePlayerNoteEmails(next);
    setSaving(true);
    try {
      await fetch('/api/portal/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receivePlayerNoteEmails: next }),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <article className="portal-admin-card">
      <h2>Notifications</h2>
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <input
          type="checkbox"
          checked={receivePlayerNoteEmails}
          disabled={loading || saving}
          onChange={(event) => void toggle(event.target.checked)}
        />
        <span>Receive Daily Player Notes emails</span>
      </label>
    </article>
  );
}
