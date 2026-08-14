import { redirect } from 'next/navigation';
import { requirePortalSession } from '../../../../lib/portal-session';
import { resolveDashboardSchoolCode } from '../../../../lib/dashboard-access';
import PlayerNotesSuite from '../../dashboard/player-notes-suite';

export default async function AdminPlayerNotesPage() {
  const session = await requirePortalSession();

  if (session.role !== 'admin' && session.role !== 'coach') {
    redirect('/portal/admin');
  }

  const selectedSchool = resolveDashboardSchoolCode(session);
  const isLeague = String(selectedSchool || '').toUpperCase() === 'LEAGUE';

  if (isLeague) {
    redirect('/portal/admin');
  }

  return (
    <div className="portal-admin-stack">
      <div className="portal-admin-headline">
        <h2>Player Notes</h2>
        <p>Log and review notes for players, with optional photo, video, or PDF attachments.</p>
      </div>
      <PlayerNotesSuite />
    </div>
  );
}
