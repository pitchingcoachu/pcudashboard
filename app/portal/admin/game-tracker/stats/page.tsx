import { redirect } from 'next/navigation';
import GameTrackerStatsView from '../../../../../components/game-tracker/game-tracker-stats';
import { requirePortalSession } from '../../../../../lib/portal-session';
import { canUseGameTracker } from '../../../../../lib/programming-scope';

export default async function GameTrackerStatsPage() {
  const session = await requirePortalSession();
  if (!(await canUseGameTracker(session))) redirect('/portal/admin');
  return <GameTrackerStatsView />;
}
