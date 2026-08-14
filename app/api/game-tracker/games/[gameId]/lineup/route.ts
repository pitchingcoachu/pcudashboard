import { gameTrackerErrorResponse, requireGameTrackerAccess } from '../../../../../../lib/game-tracker/access';
import { saveGameTrackerLineup } from '../../../../../../lib/game-tracker/db';
import { lineupSchema } from '../../../../../../lib/game-tracker/validation';

type Context = { params: Promise<{ gameId: string }> };

export async function PUT(request: Request, context: Context) {
  try {
    const access = await requireGameTrackerAccess(request, true);
    const gameId = Number((await context.params).gameId);
    const { players } = lineupSchema.parse(await request.json());
    return Response.json({ players: await saveGameTrackerLineup({ organizationId: access.organizationId, gameId, players }) });
  } catch (error) {
    return gameTrackerErrorResponse(error);
  }
}
