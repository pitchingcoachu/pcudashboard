import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { resolveClientManagementOrganizationId } from '../../../../../lib/programming-scope';
import { deleteClientUser, setPlayerStatus } from '../../../../../lib/training-db';
import { canManagePlayer } from '../../../../../lib/portal-access';

function redirectWithMessage(request: Request, redirectTo: string, key: 'ok' | 'error', value: string) {
  const url = new URL(redirectTo, request.url);
  url.searchParams.set(key, value);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const session = getSessionFromCookies(cookieStore);
    if (!session) {
      return NextResponse.redirect(new URL('/login', request.url), 303);
    }
    if (session.role !== 'admin' && session.role !== 'coach') {
      return NextResponse.redirect(new URL('/portal/player', request.url), 303);
    }

    const form = await request.formData();
    const redirectTo = String(form.get('redirectTo') ?? '/portal/admin/clients');
    const organizationId = await resolveClientManagementOrganizationId(session);
    if (organizationId <= 0) {
      return redirectWithMessage(request, redirectTo, 'error', 'Player management is not enabled for this school.');
    }

    const playerId = Number(String(form.get('playerId') ?? '0'));
    const action = String(form.get('action') ?? '').trim().toLowerCase();
    if (!Number.isFinite(playerId) || playerId <= 0) {
      return redirectWithMessage(request, redirectTo, 'error', 'Valid player is required.');
    }
    if (action !== 'delete' && action !== 'activate' && action !== 'deactivate') {
      return redirectWithMessage(request, redirectTo, 'error', 'Invalid action.');
    }

    if (action === 'delete' && session.role !== 'admin') {
      return redirectWithMessage(request, redirectTo, 'error', 'Only admins can delete players.');
    }

    const allowed = await canManagePlayer(session, playerId);
    if (!allowed) {
      return redirectWithMessage(request, redirectTo, 'error', 'You do not have access to manage this player.');
    }

    if (action === 'activate' || action === 'deactivate') {
      const nextStatus = action === 'deactivate' ? 'inactive' : 'active';
      const result = await setPlayerStatus({ organizationId, playerId, status: nextStatus });
      if (!result.ok) return redirectWithMessage(request, redirectTo, 'error', result.error);
      return redirectWithMessage(request, redirectTo, 'ok', nextStatus === 'inactive' ? 'Player deactivated.' : 'Player activated.');
    }

    const result = await deleteClientUser({ organizationId, playerId });
    if (!result.ok) return redirectWithMessage(request, redirectTo, 'error', result.error);
    return redirectWithMessage(request, redirectTo, 'ok', 'Player deleted.');
  } catch (error) {
    return redirectWithMessage(
      request,
      '/portal/admin/clients',
      'error',
      error instanceof Error ? error.message : 'Failed to update player.'
    );
  }
}
