import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { resolveClientManagementOrganizationId } from '../../../../../lib/programming-scope';
import { deleteClientUser } from '../../../../../lib/training-db';

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
    if ((session.role ?? 'admin') !== 'admin') {
      return NextResponse.redirect(new URL('/portal/player', request.url), 303);
    }

    const form = await request.formData();
    const redirectTo = String(form.get('redirectTo') ?? '/portal/admin/clients');
    const organizationId = resolveClientManagementOrganizationId(session);
    if (organizationId <= 0) {
      return redirectWithMessage(request, redirectTo, 'error', 'Player management is not enabled for this school.');
    }

    const playerId = Number(String(form.get('playerId') ?? '0'));
    const action = String(form.get('action') ?? '').trim().toLowerCase();
    if (!Number.isFinite(playerId) || playerId <= 0) {
      return redirectWithMessage(request, redirectTo, 'error', 'Valid player is required.');
    }
    if (action !== 'delete') {
      return redirectWithMessage(request, redirectTo, 'error', 'Invalid action.');
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
