import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSessionFromCookies } from './auth';
import { ensureTrainingDbReady } from './training-db';
import { refreshSchoolProductAccessCache } from './programming-scope';

export type PortalSession = {
  userId: number;
  email: string;
  name?: string;
  role: 'admin' | 'coach' | 'player';
  organizationId: number;
  playerId: number | null;
  dashboardSchoolCode?: string | null;
  appUrl: string;
  apps: Array<{ name: string; url: string }>;
};

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutPromise = new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    });
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function requirePortalSession(): Promise<PortalSession> {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);

  if (!session) {
    redirect('/login');
  }

  try {
    await withTimeout(ensureTrainingDbReady(), 6000, 'Training DB bootstrap');
  } catch {
    // Best-effort bootstrap; do not block page render if DB is slow/unavailable.
  }
  try {
    await withTimeout(refreshSchoolProductAccessCache(), 3000, 'School access cache refresh');
  } catch {
    // Cache refresh is best-effort and should not block login/page load.
  }

  return {
    userId: session.userId ?? 0,
    email: session.email,
    name: session.name,
    role: session.role === 'player' ? 'player' : session.role === 'coach' ? 'coach' : 'admin',
    organizationId: session.organizationId ?? 0,
    playerId: session.playerId ?? null,
    dashboardSchoolCode: typeof session.dashboardSchoolCode === 'string' ? session.dashboardSchoolCode.trim().toUpperCase() : null,
    appUrl: session.appUrl,
    apps: session.apps,
  };
}
