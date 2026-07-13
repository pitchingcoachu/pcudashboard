import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { ensureAuthDbReady, getDbPool, isDatabaseConfigured } from '../../../../../lib/auth-db';
import { resolveDashboardSchoolCode } from '../../../../../lib/dashboard-access';

function parseIds(value: string | null): number[] {
  return Array.from(
    new Set(
      String(value ?? '')
        .split(',')
        .map((part) => Number(part.trim()))
        .filter((id) => Number.isFinite(id) && id > 0)
        .map((id) => Math.trunc(id))
    )
  ).slice(0, 50);
}

function safeVideoMapTableName(value: unknown): string {
  const tableName = String(value ?? '').trim();
  if (/^public\.video_map[a-z0-9_]*$/i.test(tableName)) return tableName;
  if (/^video_map[a-z0-9_]*$/i.test(tableName)) return `public.${tableName}`;
  return '';
}

type VideoLookupRow = {
  pitch_event_id: number;
  play_id: string;
  video_clip_1: string | null;
  video_clip_2: string | null;
  video_clip_3: string | null;
};

export async function GET(request: Request) {
  const session = getSessionFromCookies(await cookies());
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isDatabaseConfigured()) return NextResponse.json({ error: 'DATABASE_URL is not configured.' }, { status: 500 });

  const requestUrl = new URL(request.url);
  const ids = parseIds(requestUrl.searchParams.get('ids'));
  if (!ids.length) return NextResponse.json({ pitches: [] });

  const schoolCode = resolveDashboardSchoolCode({
    userId: session.userId ?? 0,
    email: session.email,
    name: session.name,
    role: session.role === 'player' ? 'player' : session.role === 'coach' ? 'coach' : 'admin',
    organizationId: session.organizationId ?? 0,
    playerId: session.playerId ?? null,
    dashboardSchoolCode: session.dashboardSchoolCode ?? null,
    appUrl: session.appUrl,
    apps: session.apps,
  }).trim().toUpperCase();

  await ensureAuthDbReady();
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    const tableCandidates =
      schoolCode === 'TRIAL'
        ? [
            ['public.video_map_trial', 'TRIAL'],
            ['public.video_map_lsu', 'LSU'],
            ['public.video_map', 'TRIAL'],
          ]
        : [
            [`public.video_map_${schoolCode.toLowerCase()}`, schoolCode],
            ['public.video_map', schoolCode],
          ];

    let videoMapTable = '';
    let videoSchoolCode = schoolCode;
    for (const [candidate, candidateSchoolCode] of tableCandidates) {
      const tableResult = await client.query<{ reg: string | null }>(
        `SELECT to_regclass($1)::text AS reg`,
        [candidate]
      );
      const reg = safeVideoMapTableName(tableResult.rows[0]?.reg);
      if (!reg) continue;
      videoMapTable = reg;
      videoSchoolCode = candidateSchoolCode;
      break;
    }

    let videoMapHasSchoolCode = false;
    if (videoMapTable) {
      const [schemaName, tableName] = videoMapTable.split('.', 2);
      const colResult = await client.query<{ has_col: boolean }>(
        `
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = $1
            AND table_name = $2
            AND column_name = 'school_code'
        ) AS has_col
        `,
        [schemaName, tableName]
      );
      videoMapHasSchoolCode = Boolean(colResult.rows[0]?.has_col);
    }

    const pitchResult = await client.query<VideoLookupRow>(
      `
      SELECT
        pe.id AS pitch_event_id,
        COALESCE(NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'playid', to_jsonb(pe)->>'play_id', pe.playid::text, '')), ''), '') AS play_id,
        COALESCE(NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'videoclip', '')), ''), '') AS video_clip_1,
        COALESCE(NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'videoclip2', '')), ''), '') AS video_clip_2,
        COALESCE(NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'videoclip3', '')), ''), '') AS video_clip_3
      FROM public.pitch_events pe
      WHERE pe.id = ANY($1::int[])
        AND UPPER(COALESCE(pe.school_code, '')) = $2
      `,
      [ids, schoolCode]
    );

    const byPlayId = new Map<string, Pick<VideoLookupRow, 'video_clip_1' | 'video_clip_2' | 'video_clip_3'>>();
    const playIds = Array.from(
      new Set(
        pitchResult.rows
          .map((row) => String(row.play_id ?? '').trim())
          .filter(Boolean)
      )
    );

    if (videoMapTable && playIds.length) {
      try {
        await client.query(`SET statement_timeout = '3000ms'`);
        const schoolClause = videoMapHasSchoolCode
          ? `AND upper(coalesce(nullif(trim(vm.school_code), ''), $2)) = $2`
          : '';
        const mapResult = await client.query<{
          play_id: string;
          video_clip_1: string | null;
          video_clip_2: string | null;
          video_clip_3: string | null;
        }>(
          `
          SELECT
            vm.play_id,
            MAX(vm.cloudinary_url) FILTER (WHERE vm.camera_slot = 'VideoClip') AS video_clip_1,
            MAX(vm.cloudinary_url) FILTER (WHERE vm.camera_slot = 'VideoClip2') AS video_clip_2,
            MAX(vm.cloudinary_url) FILTER (WHERE vm.camera_slot = 'VideoClip3') AS video_clip_3
          FROM ${videoMapTable} vm
          WHERE vm.play_id = ANY($1::text[])
            AND vm.cloudinary_url IS NOT NULL
            AND trim(vm.cloudinary_url) <> ''
            ${schoolClause}
            AND vm.camera_slot IN ('VideoClip', 'VideoClip2', 'VideoClip3')
          GROUP BY vm.play_id
          `,
          videoMapHasSchoolCode ? [playIds, videoSchoolCode] : [playIds]
        );
        for (const row of mapResult.rows) {
          byPlayId.set(String(row.play_id ?? '').trim(), row);
        }
      } catch {
        // Return embedded pitch video columns if the external video map is slow/unavailable.
      } finally {
        try {
          await client.query('RESET statement_timeout');
        } catch {
          // Ignore reset failure; the connection will be discarded by pool error handling if needed.
        }
      }
    }

    return NextResponse.json({
      pitches: pitchResult.rows.map((row) => {
        const mapped = byPlayId.get(String(row.play_id ?? '').trim());
        return {
          pitch_event_id: Number(row.pitch_event_id),
          video_clip_1: mapped?.video_clip_1 ?? row.video_clip_1 ?? '',
          video_clip_2: mapped?.video_clip_2 ?? row.video_clip_2 ?? '',
          video_clip_3: mapped?.video_clip_3 ?? row.video_clip_3 ?? '',
        };
      }),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to refresh video URLs.' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
