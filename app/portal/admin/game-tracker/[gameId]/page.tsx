import { redirect } from 'next/navigation';
import GameTrackerLive from '../../../../../components/game-tracker/game-tracker-live';
import { requirePortalSession } from '../../../../../lib/portal-session';
import { canUseGameTracker } from '../../../../../lib/programming-scope';

export default async function LiveGameTrackerPage({ params }: { params: Promise<{ gameId: string }> }) {
  const session = await requirePortalSession();
  if (!(await canUseGameTracker(session))) redirect('/portal/admin');
  return <GameTrackerLive gameId={Number((await params).gameId)} />;
}
