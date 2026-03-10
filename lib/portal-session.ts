import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSessionFromCookies } from './auth';
import { ensureTrainingDbReady } from './training-db';

export type PortalSession = {
  userId: number;
  email: string;
  name?: string;
  role: 'admin' | 'coach' | 'player';
  organizationId: number;
  playerId: number | null;
  appUrl: string;
  apps: Array<{ name: string; url: string }>;
};

export async function requirePortalSession(): Promise<PortalSession> {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);

  if (!session) {
    redirect('/login');
  }

  await ensureTrainingDbReady();

  return {
    userId: session.userId ?? 0,
    email: session.email,
    name: session.name,
    role: session.role === 'player' ? 'player' : session.role === 'coach' ? 'coach' : 'admin',
    organizationId: session.organizationId ?? 0,
    playerId: session.playerId ?? null,
    appUrl: session.appUrl,
    apps: session.apps,
  };
}
