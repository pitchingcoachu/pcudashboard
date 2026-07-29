import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';
import { getUserEmailPreferences, setUserReceivePlayerNoteEmails } from '../../../../lib/training-db';

export async function GET() {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'admin' && session.role !== 'coach') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const prefs = await getUserEmailPreferences(session.userId ?? 0);
  return NextResponse.json({ receivePlayerNoteEmails: prefs?.receivePlayerNoteEmails ?? true });
}

export async function PATCH(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'admin' && session.role !== 'coach') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof body.receivePlayerNoteEmails !== 'boolean') {
    return NextResponse.json({ error: 'receivePlayerNoteEmails must be a boolean.' }, { status: 400 });
  }
  const result = await setUserReceivePlayerNoteEmails({
    userId: session.userId ?? 0,
    receivePlayerNoteEmails: body.receivePlayerNoteEmails,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
