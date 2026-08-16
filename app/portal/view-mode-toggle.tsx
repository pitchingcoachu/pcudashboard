'use client';

import { useRouter } from 'next/navigation';
import { VIEW_MODE_COOKIE, type ViewMode } from '../../lib/view-mode-shared';

export default function ViewModeToggle({ viewMode }: { viewMode: ViewMode }) {
  const router = useRouter();

  function setMode(next: ViewMode) {
    if (next === 'auto') {
      document.cookie = `${VIEW_MODE_COOKIE}=auto; path=/; max-age=31536000; samesite=lax`;
    } else {
      document.cookie = `${VIEW_MODE_COOKIE}=desktop; path=/; max-age=31536000; samesite=lax`;
    }
    router.refresh();
  }

  return (
    <div className="portal-viewmode-toggle" role="group" aria-label="Mobile display mode">
      <button
        type="button"
        className={`portal-viewmode-toggle-btn${viewMode === 'auto' ? ' active' : ''}`}
        onClick={() => setMode('auto')}
        aria-pressed={viewMode === 'auto'}
      >
        Mobile View
      </button>
      <button
        type="button"
        className={`portal-viewmode-toggle-btn${viewMode === 'desktop' ? ' active' : ''}`}
        onClick={() => setMode('desktop')}
        aria-pressed={viewMode === 'desktop'}
      >
        Desktop Site
      </button>
    </div>
  );
}
