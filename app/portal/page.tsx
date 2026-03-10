import { redirect } from 'next/navigation';
import { requirePortalSession } from '../../lib/portal-session';

export default async function PortalPage() {
  const session = await requirePortalSession();
  if (session.role === 'player') {
    redirect('/portal/player');
  }
  redirect('/portal/admin');
}
