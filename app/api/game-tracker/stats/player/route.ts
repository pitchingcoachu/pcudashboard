import { gameTrackerErrorResponse, requireGameTrackerAccess } from '../../../../../lib/game-tracker/access';
import { getGameTrackerPlayerDetail } from '../../../../../lib/game-tracker/db';

export async function GET(request: Request) {
  try {
    const access = await requireGameTrackerAccess(request);
    const playerKey = new URL(request.url).searchParams.get('playerKey') ?? '';
    return Response.json(await getGameTrackerPlayerDetail(access.organizationId, playerKey));
  } catch (error) { return gameTrackerErrorResponse(error); }
}
