import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/auth';
import { ensureAuthDbReady, getDbPool } from '../../../../lib/auth-db';
import { ensureTrainingDbReady } from '../../../../lib/training-db';
import { isGlobalAdminSession } from '../../../../lib/programming-scope';

async function resolveIdentity(email: string): Promise<{ userIds: number[] }> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return { userIds: [] };
  await ensureAuthDbReady();
  const pool = getDbPool();
  const result = await pool.query<{ id: number }>(
    `SELECT id FROM auth_users WHERE LOWER(email) = LOWER($1) AND COALESCE(is_active, TRUE) = TRUE`,
    [normalizedEmail]
  );
  return { userIds: result.rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0) };
}

// Lists everything the requesting user personally created across both
// saved-view features (dashboard_custom_tables, dashboard_custom_reports),
// regardless of the requester's currently-selected school -- this is a
// "things I built" management view, not the org-scoped "things visible to
// me right now" list the dashboard's own pickers use.
export async function GET(request: Request) {
  const session = getSessionFromRequest(request, await cookies());
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const normalizedEmail = String(session.email ?? '').trim().toLowerCase();
  const isGlobalAdmin = isGlobalAdminSession({ role: session.role, email: session.email });
  const { userIds } = await resolveIdentity(normalizedEmail);
  const sessionUserId = Number(session.userId ?? 0);
  const effectiveUserIds = Array.from(new Set([...(sessionUserId > 0 ? [sessionUserId] : []), ...userIds]));
  if (effectiveUserIds.length === 0 && !normalizedEmail) {
    return NextResponse.json({ tables: [], reports: [] });
  }

  await ensureTrainingDbReady();
  const pool = getDbPool();

  const tables = await pool.query<{
    id: number;
    name: string;
    school_code: string;
    visibility: string;
    columns_json: unknown;
    created_at: string;
    updated_at: string;
  }>(
    `
      SELECT id, name, school_code, visibility, columns_json, created_at::text, updated_at::text
      FROM dashboard_custom_tables
      WHERE (created_by_user_id = ANY($1::bigint[]))
        OR ($2::text <> '' AND LOWER(COALESCE(created_by_email, '')) = LOWER($2))
      ORDER BY updated_at DESC, id DESC
    `,
    [effectiveUserIds, normalizedEmail]
  ).catch(() => ({ rows: [] as never[] }));

  const reports = await pool.query<{
    id: number;
    name: string;
    school_code: string;
    visibility: string;
    applies_to_all_schools: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `
      SELECT id, name, school_code, visibility, applies_to_all_schools, created_at::text, updated_at::text
      FROM dashboard_custom_reports
      WHERE (created_by_user_id = ANY($1::bigint[]))
        OR ($2::text <> '' AND LOWER(COALESCE(created_by_email, '')) = LOWER($2))
      ORDER BY updated_at DESC, id DESC
    `,
    [effectiveUserIds, normalizedEmail]
  ).catch(() => ({ rows: [] as never[] }));

  return NextResponse.json({
    isGlobalAdmin,
    tables: tables.rows.map((row) => ({
      id: Number(row.id),
      name: row.name,
      schoolCode: row.school_code,
      visibility: row.visibility ?? 'organization',
      columnCount: Array.isArray(row.columns_json) ? row.columns_json.length : 0,
      updatedAt: row.updated_at,
    })),
    reports: reports.rows.map((row) => ({
      id: Number(row.id),
      name: row.name,
      schoolCode: row.school_code,
      visibility: row.visibility ?? (row.applies_to_all_schools ? 'global' : 'organization'),
      updatedAt: row.updated_at,
    })),
  });
}

// Changes visibility only -- ownership-checked (created_by_user_id or
// created_by_email match), 'global' silently downgraded to 'organization'
// for non-global-admin requesters rather than rejected outright, matching
// how the create/update POST routes already handle this tier.
export async function PATCH(request: Request) {
  const session = getSessionFromRequest(request, await cookies());
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const normalizedEmail = String(session.email ?? '').trim().toLowerCase();
  const isGlobalAdmin = isGlobalAdminSession({ role: session.role, email: session.email });
  const { userIds } = await resolveIdentity(normalizedEmail);
  const sessionUserId = Number(session.userId ?? 0);
  const effectiveUserIds = Array.from(new Set([...(sessionUserId > 0 ? [sessionUserId] : []), ...userIds]));

  const body = (await request.json().catch(() => null)) as
    | { kind?: 'table' | 'report'; id?: number; ids?: number[]; visibility?: string }
    | null;
  if (!body) return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  // Same conceptual table/report often has one independently-owned row per
  // school (e.g. a starter table seeded into every org) -- ids supports
  // applying one visibility change to the whole same-named group at once,
  // instead of forcing N one-at-a-time edits.
  const ids = Array.from(
    new Set([...(body.ids ?? []), body.id].map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0))
  );
  const requestedVisibility = String(body.visibility ?? '').trim().toLowerCase();
  if (ids.length === 0 || (body.kind !== 'table' && body.kind !== 'report')) {
    return NextResponse.json({ error: 'Valid kind and id(s) are required.' }, { status: 400 });
  }
  if (!['private', 'organization', 'global'].includes(requestedVisibility)) {
    return NextResponse.json({ error: 'visibility must be private, organization, or global.' }, { status: 400 });
  }
  const visibility = requestedVisibility === 'global' && !isGlobalAdmin ? 'organization' : requestedVisibility;

  await ensureTrainingDbReady();
  const pool = getDbPool();
  const table = body.kind === 'table' ? 'dashboard_custom_tables' : 'dashboard_custom_reports';
  const extraSet = body.kind === 'report' ? `, applies_to_all_schools = ${visibility === 'global' ? 'TRUE' : 'FALSE'}` : '';
  const result = await pool.query(
    `
      UPDATE ${table}
         SET visibility = $1, updated_at = NOW()${extraSet}
       WHERE id = ANY($2::bigint[])
         AND (
           created_by_user_id = ANY($3::bigint[])
           OR ($4::text <> '' AND LOWER(COALESCE(created_by_email, '')) = LOWER($4))
         )
    `,
    [visibility, ids, effectiveUserIds, normalizedEmail]
  );
  if (!(result.rowCount ?? 0)) {
    return NextResponse.json({ error: 'Not found, or you do not own any of these items.' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, visibility, updatedCount: result.rowCount ?? 0 });
}

export async function DELETE(request: Request) {
  const session = getSessionFromRequest(request, await cookies());
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const normalizedEmail = String(session.email ?? '').trim().toLowerCase();
  const { userIds } = await resolveIdentity(normalizedEmail);
  const sessionUserId = Number(session.userId ?? 0);
  const effectiveUserIds = Array.from(new Set([...(sessionUserId > 0 ? [sessionUserId] : []), ...userIds]));

  const url = new URL(request.url);
  const kind = url.searchParams.get('kind');
  const idsParam = url.searchParams.get('ids');
  const singleId = Number(url.searchParams.get('id') ?? '0');
  const ids = Array.from(
    new Set(
      [
        ...(idsParam ? idsParam.split(',') : []),
        ...(Number.isFinite(singleId) && singleId > 0 ? [singleId] : []),
      ]
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
    )
  );
  if (ids.length === 0 || (kind !== 'table' && kind !== 'report')) {
    return NextResponse.json({ error: 'Valid kind and id(s) are required.' }, { status: 400 });
  }

  await ensureTrainingDbReady();
  const pool = getDbPool();
  const table = kind === 'table' ? 'dashboard_custom_tables' : 'dashboard_custom_reports';

  const targets = await pool.query<{ id: number; name: string }>(
    `SELECT id, name FROM ${table} WHERE id = ANY($1::bigint[]) AND (created_by_user_id = ANY($2::bigint[]) OR ($3::text <> '' AND LOWER(COALESCE(created_by_email, '')) = LOWER($3)))`,
    [ids, effectiveUserIds, normalizedEmail]
  );
  if (!(targets.rowCount ?? 0)) {
    return NextResponse.json({ error: 'Not found, or you do not own any of these items.' }, { status: 404 });
  }
  const deletableIds = targets.rows
    .filter((row) => String(row.name ?? '').trim().toLowerCase() !== "jared's dashboard")
    .map((row) => row.id);
  if (deletableIds.length === 0) {
    return NextResponse.json({ error: "Jared's Dashboard is protected and cannot be deleted." }, { status: 400 });
  }

  const result = await pool.query(
    `DELETE FROM ${table} WHERE id = ANY($1::bigint[]) AND (created_by_user_id = ANY($2::bigint[]) OR ($3::text <> '' AND LOWER(COALESCE(created_by_email, '')) = LOWER($3)))`,
    [deletableIds, effectiveUserIds, normalizedEmail]
  );
  return NextResponse.json({ ok: (result.rowCount ?? 0) > 0, deletedCount: result.rowCount ?? 0 });
}
