import GameTrackerLive from '../../../../../components/game-tracker/game-tracker-live';

export default async function LiveGameTrackerPage({ params }: { params: Promise<{ gameId: string }> }) {
  return <GameTrackerLive gameId={Number((await params).gameId)} />;
}
