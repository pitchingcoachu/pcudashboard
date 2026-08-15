import type { PoolClient } from 'pg';
import { ensureAuthDbReady, getDbPool } from './auth-db';

export function parseVideoLookupIds(value: string | null): number[] {
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

export type PitchVideoUrls = {
  pitch_event_id: number;
  video_clip_1: string;
  video_clip_2: string;
  video_clip_3: string;
  // True when that slot's clip came from an Edgertronic camera (per the
  // video_map table's video_type column) -- lets the UI label that specific
  // tab "Edger" instead of the generic "Camera N", since which slot is
  // Edgertronic isn't fixed (it's almost always slot 1, but not always).
  video_clip_1_is_edger: boolean;
  video_clip_2_is_edger: boolean;
  video_clip_3_is_edger: boolean;
  // Which physical iPhone angle that slot's clip is, per the video_map
  // table's camera_target column ("PitchersBack" -> 'back', "PitchersOpenSide"
  // or "PitchersFront" -> 'side', blank/unrecognized -> null). Slot number
  // alone isn't a reliable proxy for this -- confirmed via a real data check
  // that "PitchersOpenSide" clips land in VideoClip2 for some pitches and
  // VideoClip3 for others -- so exports need this to show a consistent
  // Back/Side ordering instead of whatever slot Trackman happened to upload
  // to first.
  video_clip_1_view: 'back' | 'side' | null;
  video_clip_2_view: 'back' | 'side' | null;
  video_clip_3_view: 'back' | 'side' | null;
};

// "PitchersOpenSide" (landscape) and the rare "PitchersFront" both read as
// the non-Back angle for export layout purposes -- there's no third position
// in the fixed 2-up Back/Side layout, and PitchersFront is too rare (~25
// clips total in a real data check) to warrant its own slot.
function normalizeCameraView(target: string | null | undefined): 'back' | 'side' | null {
  const normalized = String(target ?? '').trim().toLowerCase();
  if (normalized === 'pitchersback') return 'back';
  if (normalized === 'pitchersopenside' || normalized === 'pitchersfront') return 'side';
  return null;
}

type VideoMapMeta = {
  tableName: string;
  schoolCode: string;
  hasSchoolCode: boolean;
};

const videoMapMetaCache = new Map<string, VideoMapMeta | null>();

async function resolveVideoMapMeta(client: PoolClient, schoolCode: string): Promise<VideoMapMeta | null> {
  const cacheKey = schoolCode.trim().toUpperCase();
  if (videoMapMetaCache.has(cacheKey)) return videoMapMetaCache.get(cacheKey) ?? null;

  const tableCandidates =
    cacheKey === 'TRIAL'
      ? [
          ['public.video_map_trial', 'TRIAL'],
          ['public.video_map_lsu', 'LSU'],
          ['public.video_map', 'TRIAL'],
        ]
      : [
          [`public.video_map_${cacheKey.toLowerCase()}`, cacheKey],
          ['public.video_map', cacheKey],
        ];

  for (const [candidate, candidateSchoolCode] of tableCandidates) {
    const tableResult = await client.query<{ reg: string | null }>(`SELECT to_regclass($1)::text AS reg`, [candidate]);
    const tableNameSafe = safeVideoMapTableName(tableResult.rows[0]?.reg);
    if (!tableNameSafe) continue;

    const [schemaName, tableName] = tableNameSafe.split('.', 2);
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
    const meta = {
      tableName: tableNameSafe,
      schoolCode: candidateSchoolCode,
      hasSchoolCode: Boolean(colResult.rows[0]?.has_col),
    };
    videoMapMetaCache.set(cacheKey, meta);
    return meta;
  }

  videoMapMetaCache.set(cacheKey, null);
  return null;
}

/** Resolves Cloudinary clip URLs for a set of pitch_event ids, scoped to
 * schoolCode -- shared by /api/dashboard/pitching/video-lookup (single-pitch
 * modal refresh) and /api/dashboard/pitching/video-export (bulk export),
 * so access-control/lookup logic lives in exactly one place. */
export async function lookupPitchVideoUrls(ids: number[], schoolCode: string): Promise<PitchVideoUrls[]> {
  if (!ids.length) return [];
  await ensureAuthDbReady();
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    const videoMapMeta = await resolveVideoMapMeta(client, schoolCode);
    const videoMapTable = videoMapMeta?.tableName ?? '';
    const videoSchoolCode = videoMapMeta?.schoolCode ?? schoolCode;
    const videoMapHasSchoolCode = videoMapMeta?.hasSchoolCode ?? false;

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

    const byPlayId = new Map<
      string,
      {
        video_clip_1: string | null;
        video_clip_2: string | null;
        video_clip_3: string | null;
        video_clip_1_is_edger: boolean;
        video_clip_2_is_edger: boolean;
        video_clip_3_is_edger: boolean;
        video_clip_1_target: string | null;
        video_clip_2_target: string | null;
        video_clip_3_target: string | null;
      }
    >();
    const playIds = Array.from(new Set(pitchResult.rows.map((row) => String(row.play_id ?? '').trim()).filter(Boolean)));

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
          video_clip_1_is_edger: boolean;
          video_clip_2_is_edger: boolean;
          video_clip_3_is_edger: boolean;
          video_clip_1_target: string | null;
          video_clip_2_target: string | null;
          video_clip_3_target: string | null;
        }>(
          // video_type is occasionally wrong at the source (confirmed: ~16 rows
          // tagged video_type='EdgertronicVideos' with camera_name='iPhone' --
          // a real upload-pipeline mislabel, not a query bug). camera_name is
          // the more direct signal when it's explicitly set, so an explicit
          // 'iPhone' camera_name always overrides video_type and forces
          // non-Edger, even if video_type disagrees.
          `
          SELECT
            vm.play_id,
            MAX(vm.cloudinary_url) FILTER (WHERE vm.camera_slot = 'VideoClip') AS video_clip_1,
            MAX(vm.cloudinary_url) FILTER (WHERE vm.camera_slot = 'VideoClip2') AS video_clip_2,
            MAX(vm.cloudinary_url) FILTER (WHERE vm.camera_slot = 'VideoClip3') AS video_clip_3,
            BOOL_OR(vm.camera_slot = 'VideoClip' AND vm.video_type = 'EdgertronicVideos' AND coalesce(vm.camera_name, '') <> 'iPhone') AS video_clip_1_is_edger,
            BOOL_OR(vm.camera_slot = 'VideoClip2' AND vm.video_type = 'EdgertronicVideos' AND coalesce(vm.camera_name, '') <> 'iPhone') AS video_clip_2_is_edger,
            BOOL_OR(vm.camera_slot = 'VideoClip3' AND vm.video_type = 'EdgertronicVideos' AND coalesce(vm.camera_name, '') <> 'iPhone') AS video_clip_3_is_edger,
            MAX(vm.camera_target) FILTER (WHERE vm.camera_slot = 'VideoClip') AS video_clip_1_target,
            MAX(vm.camera_target) FILTER (WHERE vm.camera_slot = 'VideoClip2') AS video_clip_2_target,
            MAX(vm.camera_target) FILTER (WHERE vm.camera_slot = 'VideoClip3') AS video_clip_3_target
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

    return pitchResult.rows.map((row) => {
      const mapped = byPlayId.get(String(row.play_id ?? '').trim());
      return {
        pitch_event_id: Number(row.pitch_event_id),
        video_clip_1: mapped?.video_clip_1 ?? row.video_clip_1 ?? '',
        video_clip_2: mapped?.video_clip_2 ?? row.video_clip_2 ?? '',
        video_clip_3: mapped?.video_clip_3 ?? row.video_clip_3 ?? '',
        video_clip_1_is_edger: mapped?.video_clip_1_is_edger ?? false,
        video_clip_2_is_edger: mapped?.video_clip_2_is_edger ?? false,
        video_clip_3_is_edger: mapped?.video_clip_3_is_edger ?? false,
        video_clip_1_view: normalizeCameraView(mapped?.video_clip_1_target),
        video_clip_2_view: normalizeCameraView(mapped?.video_clip_2_target),
        video_clip_3_view: normalizeCameraView(mapped?.video_clip_3_target),
      };
    });
  } finally {
    client.release();
  }
}

export type PitchExportMetrics = {
  pitch_event_id: number;
  pitcher: string;
  batter: string;
  session_date: string;
  pitch_type: string;
  velo: number | null;
  ivb: number | null;
  hb: number | null;
  spin: number | null;
  spin_eff: number | null;
  release_tilt: string;
  break_tilt: string;
  release_height: number | null;
  release_side: number | null;
  extension: number | null;
  plate_side: number | null;
  plate_height: number | null;
  school_code: string;
};

const EXPORT_VELO_NUMBER_SQL = "(regexp_match(COALESCE(pe.relspeed, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision";
const EXPORT_IVB_NUMBER_SQL = "(regexp_match(COALESCE(pe.inducedvertbreak, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision";
const EXPORT_HB_NUMBER_SQL = "(regexp_match(COALESCE(pe.horzbreak, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision";
const EXPORT_TAGGED_PITCH_TYPE_TOKEN_SQL = "regexp_replace(lower(COALESCE(TRIM(pe.taggedpitchtype), '')), '[^a-z0-9]', '', 'g')";
// Mirrors app/api/dashboard/pitching/overview/route.ts's PITCH_TYPE_SQL so
// the export overlay's pitch-type label/color matches what the modal and
// charts show for the same pitch.
const EXPORT_PITCH_TYPE_SQL = `
CASE
  WHEN ${EXPORT_TAGGED_PITCH_TYPE_TOKEN_SQL} IN ('', 'unknown', 'undefined', 'other', 'untagged', 'na', 'none', 'null') THEN 'Undefined'
  WHEN ${EXPORT_TAGGED_PITCH_TYPE_TOKEN_SQL} IN ('fastball', 'fourseam', 'fourseamfastball', 'ff', 'fa') THEN 'Fastball'
  WHEN ${EXPORT_TAGGED_PITCH_TYPE_TOKEN_SQL} IN ('sinker', 'oneseamfastball', 'twoseam', 'twoseamfastball', 'twoseamfasball', 'si', 'ft') THEN 'Sinker'
  WHEN ${EXPORT_TAGGED_PITCH_TYPE_TOKEN_SQL} IN ('changeup', 'ch') THEN 'ChangeUp'
  WHEN ${EXPORT_TAGGED_PITCH_TYPE_TOKEN_SQL} IN ('sweeper', 'st') THEN 'Sweeper'
  WHEN ${EXPORT_TAGGED_PITCH_TYPE_TOKEN_SQL} IN ('splitter', 'splitfinger', 'splitfingerfastball', 'sp', 'fs') THEN 'Splitter'
  WHEN ${EXPORT_TAGGED_PITCH_TYPE_TOKEN_SQL} IN ('curveball', 'cu', 'knucklecurve', 'kc') THEN 'Curveball'
  WHEN ${EXPORT_TAGGED_PITCH_TYPE_TOKEN_SQL} IN ('cutter', 'fc') THEN 'Cutter'
  WHEN ${EXPORT_TAGGED_PITCH_TYPE_TOKEN_SQL} IN ('slider', 'sl') THEN 'Slider'
  WHEN ${EXPORT_TAGGED_PITCH_TYPE_TOKEN_SQL} IN ('knuckleball', 'kn') THEN 'Knuckleball'
  ELSE COALESCE(NULLIF(TRIM(pe.taggedpitchtype), ''), 'Undefined')
END`;

/** Pulls the same metrics/location fields the pitch video modal shows
 * (renderVideoPitchMetrics + the strike-zone plate location) for the
 * export route's video overlay -- kept separate from
 * lookupPitchVideoUrls, which is also used by the lightweight single-pitch
 * modal refresh where this extra data isn't needed. */
export async function lookupPitchExportMetrics(ids: number[], schoolCode: string): Promise<PitchExportMetrics[]> {
  if (!ids.length) return [];
  await ensureAuthDbReady();
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    const result = await client.query<{
      pitch_event_id: number;
      pitcher: string;
      batter: string;
      session_date: string;
      pitch_type: string;
      velo: number | null;
      ivb: number | null;
      hb: number | null;
      spin: number | null;
      spin_eff: number | null;
      release_tilt: string;
      break_tilt: string;
      release_height: number | null;
      release_side: number | null;
      extension: number | null;
      plate_side: number | null;
      plate_height: number | null;
      school_code: string;
    }>(
      `
      SELECT
        pe.id AS pitch_event_id,
        COALESCE(NULLIF(TRIM(pe.pitcher), ''), NULLIF(TRIM(to_jsonb(pe)->>'Pitcher'), ''), NULLIF(TRIM(to_jsonb(pe)->>'pitcher_name'), ''), 'Unknown Pitcher') AS pitcher,
        COALESCE(NULLIF(TRIM(pe.batter), ''), '') AS batter,
        pe.session_date::text AS session_date,
        ${EXPORT_PITCH_TYPE_SQL} AS pitch_type,
        ${EXPORT_VELO_NUMBER_SQL} AS velo,
        ${EXPORT_IVB_NUMBER_SQL} AS ivb,
        ${EXPORT_HB_NUMBER_SQL} AS hb,
        (regexp_match(COALESCE(pe.spinrate, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS spin,
        (regexp_match(COALESCE(pe.spinefficiency, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS spin_eff,
        COALESCE(NULLIF(TRIM(pe.releasetilt), ''), '') AS release_tilt,
        COALESCE(NULLIF(TRIM(pe.breaktilt), ''), '') AS break_tilt,
        (regexp_match(COALESCE(pe.relheight, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS release_height,
        (regexp_match(COALESCE(pe.relside, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS release_side,
        (regexp_match(COALESCE(pe.extension, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS extension,
        (regexp_match(COALESCE(pe.platelocside, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS plate_side,
        (regexp_match(COALESCE(pe.platelocheight, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS plate_height,
        UPPER(COALESCE(pe.school_code, '')) AS school_code
      FROM public.pitch_events pe
      WHERE pe.id = ANY($1::int[])
        AND UPPER(COALESCE(pe.school_code, '')) = $2
      `,
      [ids, schoolCode]
    );
    return result.rows.map((row) => ({
      ...row,
      pitch_event_id: Number(row.pitch_event_id),
    }));
  } finally {
    client.release();
  }
}
