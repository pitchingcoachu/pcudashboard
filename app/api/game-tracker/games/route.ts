import { createGameTrackerGame, listGameTrackerGames } from '../../../../lib/game-tracker/db';
import { gameTrackerErrorResponse, requireGameTrackerAccess } from '../../../../lib/game-tracker/access';
import { createGameSchema } from '../../../../lib/game-tracker/validation';

export async function GET(request: Request) {
  try {
    const access = await requireGameTrackerAccess(request);
    return Response.json({ games: await listGameTrackerGames(access.organizationId) });
  } catch (error) {
    return gameTrackerErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const access = await requireGameTrackerAccess(request, true);
    const body = createGameSchema.parse(await request.json());
    const game = await createGameTrackerGame({
      ...body,
      organizationId: access.organizationId,
      schoolCode: access.schoolCode,
      createdByUserId: access.session.userId ?? null,
    });
    return Response.json({ game }, { status: 201 });
  } catch (error) {
    return gameTrackerErrorResponse(error);
  }
}
