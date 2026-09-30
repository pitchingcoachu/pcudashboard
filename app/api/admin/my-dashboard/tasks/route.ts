import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/auth';
import { resolvePlayerContentOrganizationId } from '../../../../../lib/player-content-scope';
import {
  createCoachDashboardTask,
  deleteCoachDashboardTask,
  listCoachDashboardTasks,
  parseTaskFields,
  updateCoachDashboardTask,
} from '../../../../../lib/coach-dashboard-tasks-db';

async function staffContext(request: Request) {
  const session = getSessionFromRequest(request, await cookies());
  if (!session || session.role === 'player' || !session.userId) return null;
  const organizationId = await resolvePlayerContentOrganizationId(session);
  return organizationId > 0 ? { organizationId, ownerUserId: session.userId } : null;
}

const denied = () => NextResponse.json({ error: 'Staff access required.' }, { status: 403 });
const failed = (error: unknown, fallback: string) => NextResponse.json({ error: error instanceof Error ? error.message : fallback }, { status: 400 });

export async function GET(request: Request) {
  const context = await staffContext(request);
  if (!context) return denied();
  const status = new URL(request.url).searchParams.get('status') === 'completed' ? 'completed' : 'open';
  try {
    return NextResponse.json(await listCoachDashboardTasks({ ...context, status }));
  } catch (error) {
    return failed(error, 'Could not load your tasks.');
  }
}

export async function POST(request: Request) {
  const context = await staffContext(request);
  if (!context) return denied();
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  try {
    return NextResponse.json({ task: await createCoachDashboardTask({ ...context, ...parseTaskFields(body) }) });
  } catch (error) {
    return failed(error, 'Could not save the task.');
  }
}

export async function PATCH(request: Request) {
  const context = await staffContext(request);
  if (!context) return denied();
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const id = Number(body.id);
  if (!(id > 0)) return NextResponse.json({ error: 'id is required.' }, { status: 400 });
  try {
    const task = await updateCoachDashboardTask({
      ...context, id,
      fields: 'title' in body ? parseTaskFields(body) : undefined,
      completed: typeof body.completed === 'boolean' ? body.completed : undefined,
    });
    return task ? NextResponse.json({ task }) : NextResponse.json({ error: 'Task not found.' }, { status: 404 });
  } catch (error) {
    return failed(error, 'Could not update the task.');
  }
}

export async function DELETE(request: Request) {
  const context = await staffContext(request);
  if (!context) return denied();
  const id = Number(new URL(request.url).searchParams.get('id') ?? 0);
  if (!(id > 0)) return NextResponse.json({ error: 'id is required.' }, { status: 400 });
  return NextResponse.json({ ok: await deleteCoachDashboardTask({ ...context, id }) });
}
