'use client';

import { useEffect, useState } from 'react';

type ThemeMode = 'dark' | 'light';

const STORAGE_KEY = 'pcu-theme';

function applyTheme(theme: ThemeMode) {
  if (typeof document === 'undefined') return;
  document.body.classList.toggle('theme-light', theme === 'light');
}

export default function PortalThemeToggle() {
  const [theme, setTheme] = useState<ThemeMode>('dark');

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'light') setTheme('light');
    } catch {
      // Ignore storage failures; keep default dark theme.
    }
  }, []);

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Ignore storage failures; keep in-memory/theme class behavior.
    }
  }, [theme]);

  return (
    <div className="portal-theme-toggle" role="group" aria-label="Color theme">
      <button
        type="button"
        className={`portal-theme-toggle-btn${theme === 'dark' ? ' active' : ''}`}
        onClick={() => setTheme('dark')}
        aria-pressed={theme === 'dark'}
        aria-label="Dark mode"
        title="Dark mode"
      >
        <span className="portal-theme-toggle-icon portal-theme-toggle-icon--moon" aria-hidden="true">☾</span>
      </button>
      <button
        type="button"
        className={`portal-theme-toggle-btn${theme === 'light' ? ' active' : ''}`}
        onClick={() => setTheme('light')}
        aria-pressed={theme === 'light'}
        aria-label="Light mode"
        title="Light mode"
      >
        <span className="portal-theme-toggle-icon" aria-hidden="true">☀</span>
      </button>
    </div>
  );
}
