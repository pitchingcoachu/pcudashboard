import { redirect } from 'next/navigation';
import GameTrackerRosters from '../../../../../components/game-tracker/game-tracker-rosters';
import { requirePortalSession } from '../../../../../lib/portal-session';
import { canUseGameTracker } from '../../../../../lib/programming-scope';

export default async function GameTrackerTeamsPage() {
  const session = await requirePortalSession();
  if (!(await canUseGameTracker(session))) redirect('/portal/admin');
  return <GameTrackerRosters />;
}
