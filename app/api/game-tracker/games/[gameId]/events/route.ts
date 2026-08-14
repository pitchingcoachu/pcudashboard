import { gameTrackerErrorResponse, requireGameTrackerAccess } from '../../../../../../lib/game-tracker/access';
import { appendGameTrackerEvent, undoLastGameTrackerEvent } from '../../../../../../lib/game-tracker/db';
import { appendEventSchema } from '../../../../../../lib/game-tracker/validation';
import type { GameEventInput } from '../../../../../../lib/game-tracker/types';

type Context = { params: Promise<{ gameId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const access = await requireGameTrackerAccess(request, true);
    const gameId = Number((await context.params).gameId);
    const body = appendEventSchema.parse(await request.json());
    return Response.json(await appendGameTrackerEvent({
      organizationId: access.organizationId,
      gameId,
      ...body,
      event: body.event as GameEventInput,
      userId: access.session.userId ?? null,
    }));
  } catch (error) {
    return gameTrackerErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const access = await requireGameTrackerAccess(request, true);
    const gameId = Number((await context.params).gameId);
    return Response.json(await undoLastGameTrackerEvent({
      organizationId: access.organizationId,
      gameId,
      userId: access.session.userId ?? null,
    }));
  } catch (error) {
    return gameTrackerErrorResponse(error);
  }
}
