import { gameTrackerErrorResponse, requireGameTrackerAccess } from '../../../../../../lib/game-tracker/access';
import { changeGameTrackerPlayerPosition, saveGameTrackerLineup, substituteGameTrackerPlayer } from '../../../../../../lib/game-tracker/db';
import { lineupActionSchema, lineupSchema } from '../../../../../../lib/game-tracker/validation';

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

export async function POST(request: Request, context: Context) {
  try {
    const access = await requireGameTrackerAccess(request, true);
    const gameId = Number((await context.params).gameId);
    const input = lineupActionSchema.parse(await request.json());
    const result = input.action === 'substitute'
      ? await substituteGameTrackerPlayer({
          organizationId: access.organizationId,
          gameId,
          outgoingPlayerId: input.outgoingPlayerId,
          incoming: input.incoming,
        })
      : await changeGameTrackerPlayerPosition({
          organizationId: access.organizationId,
          gameId,
          playerId: input.playerId,
          position: input.position,
        });
    return Response.json(result);
  } catch (error) {
    return gameTrackerErrorResponse(error);
  }
}
