import { redirect } from 'next/navigation';
import GameTrackerPlayerStats from '../../../../../../../components/game-tracker/game-tracker-player-stats';
import { requirePortalSession } from '../../../../../../../lib/portal-session';
import { canUseGameTracker } from '../../../../../../../lib/programming-scope';

export default async function GameTrackerPlayerStatsPage({ params }: { params: Promise<{ playerKey: string }> }) {
  const session = await requirePortalSession();
  if (!(await canUseGameTracker(session))) redirect('/portal/admin');
  return <GameTrackerPlayerStats playerKey={decodeURIComponent((await params).playerKey)} />;
}
