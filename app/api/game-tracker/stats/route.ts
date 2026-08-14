import { gameTrackerErrorResponse, requireGameTrackerAccess } from '../../../../lib/game-tracker/access';
import { getGameTrackerStats } from '../../../../lib/game-tracker/db';
import { GAME_TYPES, type GameType, type Handedness, type ThrowingHand } from '../../../../lib/game-tracker/types';

export async function GET(request: Request) {
  try {
    const access = await requireGameTrackerAccess(request);
    const params = new URL(request.url).searchParams;
    const gameTypes = params.getAll('gameType').filter((value): value is GameType => GAME_TYPES.includes(value as GameType));
    const outsRaw = params.get('outs');
    const playerRaw = params.get('playerId');
    const stats = await getGameTrackerStats(access.organizationId, {
      gameTypes,
      dateFrom: params.get('dateFrom'),
      dateTo: params.get('dateTo'),
      count: params.get('count'),
      outs: outsRaw === null || outsRaw === '' ? null : Number(outsRaw),
      baseState: params.get('baseState') as never,
      batterHand: params.get('batterHand') as Handedness | null,
      pitcherHand: params.get('pitcherHand') as ThrowingHand | null,
      playerId: playerRaw ? Number(playerRaw) : null,
    });
    return Response.json(stats);
  } catch (error) {
    return gameTrackerErrorResponse(error);
  }
}
