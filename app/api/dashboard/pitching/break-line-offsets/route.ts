import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/auth';
import { ensureAuthDbReady, getDbPool, isDatabaseConfigured } from '../../../../../lib/auth-db';

// break_line_offsets_grid has no 'AAA' row (see scripts/refresh_break_line_offsets_grid.py) --
// AAA pitchers fall back to the MLB grid, the closest available pro comparison pool.
function normalizeLevel(value: string): string {
  const raw = String(value ?? '').trim().toUpperCase();
  if (!raw || raw === 'ALL') return 'ALL';
  if (raw === 'AAA') return 'MLB';
  return raw;
}

function normalizeBasePitchType(value: string): 'Fastball' | 'Sinker' | null {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === 'fastball') return 'Fastball';
  if (raw === 'sinker') return 'Sinker';
  return null;
}

const BUCKET_STEP = 2;
// Matches FLOOR(x / 2.0) * 2 in scripts/refresh_break_line_offsets_grid.py.
function toBucket(value: number): number {
  return Math.floor(value / BUCKET_STEP) * BUCKET_STEP;
}

type OffsetRow = {
  offspeed_pitch_type: string;
  avg_ivb_offset: number;
  avg_hb_offset: number;
  sample_size: number;
  used_fallback: boolean;
};

export async function GET(request: Request) {
  const session = getSessionFromRequest(request, await cookies());
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isDatabaseConfigured()) return NextResponse.json({ error: 'DATABASE_URL is not configured.' }, { status: 500 });

  const url = new URL(request.url);
  const level = normalizeLevel(String(url.searchParams.get('level') ?? ''));
  const basePitchType = normalizeBasePitchType(String(url.searchParams.get('base_pitch_type') ?? ''));
  const fbIvb = Number(url.searchParams.get('fb_ivb'));
  const fbHb = Number(url.searchParams.get('fb_hb'));

  if (!basePitchType || !Number.isFinite(fbIvb) || !Number.isFinite(fbHb)) {
    return NextResponse.json({ error: 'base_pitch_type, fb_ivb, and fb_hb are required.' }, { status: 400 });
  }

  await ensureAuthDbReady();
  const pool = getDbPool();

  const ivbBucket = toBucket(fbIvb);
  const hbBucket = toBucket(fbHb);

  // Exact bucket first; if this level has no rows there at all (rather than
  // just being individually sparse -- that's what used_fallback already
  // covers server-side at refresh time), widen to the nearest populated
  // bucket for this level so an unusual fastball shape still gets a line
  // instead of silently rendering nothing.
  const client = await pool.connect();
  try {
    const exact = await client.query<OffsetRow>(
      `SELECT offspeed_pitch_type, avg_ivb_offset, avg_hb_offset, sample_size, used_fallback
       FROM public.break_line_offsets_grid
       WHERE level = $1 AND base_pitch_type = $2 AND fb_ivb_bucket = $3 AND fb_hb_bucket = $4`,
      [level, basePitchType, ivbBucket, hbBucket]
    );
    if (exact.rows.length > 0) {
      return NextResponse.json({ level, base_pitch_type: basePitchType, offsets: exact.rows, nearest_bucket_used: false });
    }

    // Nearest bucket per off-speed type independently -- a plain global
    // LIMIT would let one pitch type's dense nearby buckets crowd out a
    // rarer type's own nearest bucket.
    const nearest = await client.query<OffsetRow>(
      `SELECT DISTINCT ON (offspeed_pitch_type)
         offspeed_pitch_type, avg_ivb_offset, avg_hb_offset, sample_size, used_fallback
       FROM public.break_line_offsets_grid
       WHERE level = $1 AND base_pitch_type = $2
       ORDER BY offspeed_pitch_type, (fb_ivb_bucket - $3) ^ 2 + (fb_hb_bucket - $4) ^ 2 ASC`,
      [level, basePitchType, ivbBucket, hbBucket]
    );
    return NextResponse.json({ level, base_pitch_type: basePitchType, offsets: nearest.rows, nearest_bucket_used: true });
  } finally {
    client.release();
  }
}
