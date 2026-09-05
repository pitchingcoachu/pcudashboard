'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { unregisterNativePushDevice } from './native-push-registration';

export default function LogoutButton() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const handleLogout = async () => {
    setIsLoading(true);
    await unregisterNativePushDevice();
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  };

  return (
    <button type="button" className="btn btn-ghost" onClick={handleLogout} disabled={isLoading}>
      {isLoading ? 'Logging Out...' : 'Log Out'}
    </button>
  );
}
