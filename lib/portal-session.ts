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

export async function requirePortalSession(): Promise<PortalSession> {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);

  if (!session) {
    redirect('/login');
  }

  // Fire-and-forget warmup so auth/session rendering never blocks on DB bootstrap.
  void ensureTrainingDbReady().catch(() => {});
  void refreshSchoolProductAccessCache().catch(() => {});

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
