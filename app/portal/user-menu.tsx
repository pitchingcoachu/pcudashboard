'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type PortalUserMenuProps = {
  displayName: string;
};

export default function PortalUserMenu({ displayName }: PortalUserMenuProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [receivePlayerNoteEmails, setReceivePlayerNoteEmails] = useState(true);
  const [loadingPrefs, setLoadingPrefs] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setSettingsOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        setSettingsOpen(false);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const openSettings = async () => {
    setSettingsOpen(true);
    setLoadingPrefs(true);
    try {
      const response = await fetch('/api/portal/settings', { cache: 'no-store' });
      if (response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { receivePlayerNoteEmails?: boolean };
        setReceivePlayerNoteEmails(payload.receivePlayerNoteEmails !== false);
      }
    } finally {
      setLoadingPrefs(false);
    }
  };

  const toggleReceivePlayerNoteEmails = async (next: boolean) => {
    setReceivePlayerNoteEmails(next);
    setSavingPrefs(true);
    try {
      await fetch('/api/portal/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receivePlayerNoteEmails: next }),
      });
    } finally {
      setSavingPrefs(false);
    }
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  };

  return (
    <div className="portal-user-menu" ref={wrapRef}>
      <button
        type="button"
        className="portal-user-meta portal-user-meta-btn"
        aria-label="Account menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <p>Logged In As</p>
        <h1>{displayName}</h1>
      </button>
      {open ? (
        <div className="portal-user-menu-dropdown">
          {settingsOpen ? (
            <div className="portal-user-menu-settings">
              <p className="portal-user-menu-settings-title">Settings</p>
              <label className="portal-user-menu-checkbox-row">
                <input
                  type="checkbox"
                  checked={receivePlayerNoteEmails}
                  disabled={loadingPrefs || savingPrefs}
                  onChange={(event) => void toggleReceivePlayerNoteEmails(event.target.checked)}
                />
                <span>Receive Daily Player Notes emails</span>
              </label>
              <button type="button" className="btn btn-ghost portal-user-menu-back" onClick={() => setSettingsOpen(false)}>
                Back
              </button>
            </div>
          ) : (
            <>
              <button type="button" className="btn btn-ghost portal-user-menu-item" onClick={() => void openSettings()}>
                Settings
              </button>
              <button type="button" className="btn btn-ghost portal-user-menu-item" onClick={() => void handleLogout()} disabled={loggingOut}>
                {loggingOut ? 'Logging Out...' : 'Log Out'}
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
