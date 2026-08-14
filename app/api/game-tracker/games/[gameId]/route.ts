import { gameTrackerErrorResponse, requireGameTrackerAccess } from '../../../../../lib/game-tracker/access';
import { getGameTrackerBundle, setGameTrackerStatus } from '../../../../../lib/game-tracker/db';
import { statusSchema } from '../../../../../lib/game-tracker/validation';

type Context = { params: Promise<{ gameId: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const access = await requireGameTrackerAccess(request);
    const gameId = Number((await context.params).gameId);
    const bundle = await getGameTrackerBundle(access.organizationId, gameId);
    if (!bundle) return Response.json({ error: 'Game not found.' }, { status: 404 });
    return Response.json(bundle);
  } catch (error) {
    return gameTrackerErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const access = await requireGameTrackerAccess(request, true);
    const gameId = Number((await context.params).gameId);
    const { status } = statusSchema.parse(await request.json());
    return Response.json({ game: await setGameTrackerStatus({ organizationId: access.organizationId, gameId, status }) });
  } catch (error) {
    return gameTrackerErrorResponse(error);
  }
}
