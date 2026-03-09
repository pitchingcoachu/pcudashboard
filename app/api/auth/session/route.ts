import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSessionFromCookies } from '../../../../lib/auth';

export async function GET() {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);

  if (!session) {
    return NextResponse.json({ authenticated: false });
  }

  return NextResponse.json({
    authenticated: true,
    name: session.name ?? null,
    email: session.email,
    role: session.role ?? 'admin',
    organizationId: session.organizationId ?? null,
    playerId: session.playerId ?? null,
  });
}
