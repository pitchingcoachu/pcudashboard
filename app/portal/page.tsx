import { redirect } from 'next/navigation';
import { requirePortalSession } from '../../lib/portal-session';
import { canUseProgrammingData } from '../../lib/programming-scope';

export default async function PortalPage() {
  const session = await requirePortalSession();
  if (session.role === 'player') {
    redirect(canUseProgrammingData(session) ? '/portal/player' : '/portal/dashboard');
  }
  redirect('/portal/admin');
}
