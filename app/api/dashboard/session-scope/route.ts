import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/auth';
import { isGlobalAdminSession } from '../../../../lib/programming-scope';

// Tells dashboard save UIs (custom tables, custom reports) whether the
// current session can offer an "All Sites" scope option -- true global
// admins only, not every admin-role user. Kept separate from
// /api/auth/session (a widely shared endpoint, including mobile) since this
// is purely a dashboard-save concern.
export async function GET(request: Request) {
  const session = getSessionFromRequest(request, await cookies());
  if (!session) return NextResponse.json({ isGlobalAdmin: false });
  return NextResponse.json({
    isGlobalAdmin: isGlobalAdminSession({
      role: session.role === 'player' ? 'player' : session.role === 'coach' ? 'coach' : 'admin',
      email: session.email,
    }),
  });
}
