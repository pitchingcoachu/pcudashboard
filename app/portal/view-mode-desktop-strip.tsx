'use client';

import { useRouter } from 'next/navigation';
import { VIEW_MODE_COOKIE } from '../../lib/view-mode-shared';

export default function ViewModeDesktopStrip() {
  const router = useRouter();

  function switchToMobile() {
    document.cookie = `${VIEW_MODE_COOKIE}=auto; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }

  return (
    <div className="portal-viewmode-strip" role="note">
      <span>You&apos;re viewing the desktop site.</span>
      <button type="button" className="portal-viewmode-strip-btn" onClick={switchToMobile}>
        Switch to mobile view
      </button>
    </div>
  );
}
