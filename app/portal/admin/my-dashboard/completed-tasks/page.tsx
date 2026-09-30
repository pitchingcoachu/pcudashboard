import { redirect } from 'next/navigation';
import { requirePortalSession } from '../../../../../lib/portal-session';
import CompletedTasks from './completed-tasks';

export default async function CompletedTasksPage() {
  const session = await requirePortalSession();
  if (session.role === 'player') redirect('/portal/player');
  return <CompletedTasks />;
}
