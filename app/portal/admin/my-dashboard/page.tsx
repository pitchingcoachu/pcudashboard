import { redirect } from 'next/navigation';
import { requirePortalSession } from '../../../../lib/portal-session';
import CoachDashboard from './coach-dashboard';

function firstName(name: string | undefined, email: string): string {
  const display = String(name ?? '').trim();
  if (display.includes(',')) return display.split(',').slice(1).join(' ').trim().split(/\s+/)[0] || 'Coach';
  return display.split(/\s+/)[0] || email.split('@')[0] || 'Coach';
}

export default async function MyDashboardPage() {
  const session = await requirePortalSession();
  if (session.role === 'player') redirect('/portal/player');
  return <CoachDashboard firstName={firstName(session.name, session.email)} />;
}
