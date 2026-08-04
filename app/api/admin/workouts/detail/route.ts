import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/auth';
import { resolveProgrammingOrganizationId } from '../../../../../lib/programming-scope';
import { getWorkoutByIdInOrganization } from '../../../../../lib/training-db';

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const workoutId = Number(searchParams.get('workoutId') ?? 0);
  if (!Number.isFinite(workoutId) || workoutId <= 0) {
    return NextResponse.json({ error: 'Valid workoutId is required.' }, { status: 400 });
  }

  const organizationId = await resolveProgrammingOrganizationId(session);
  const workout = await getWorkoutByIdInOrganization({ organizationId, workoutId });
  if (!workout) return NextResponse.json({ error: 'Workout not found.' }, { status: 404 });

  return NextResponse.json({ workout });
}
