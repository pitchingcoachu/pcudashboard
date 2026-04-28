#!/usr/bin/env python3
import os
import sys
import psycopg

SQL = r'''
WITH src AS (
  SELECT
    pe.session_date::date AS session_date,
    'ALL'::text AS level_bucket,
    LOWER(TRIM(COALESCE(pe.batter, ''))) AS batter_norm,
    UPPER(COALESCE(NULLIF(TRIM(pe.batterteam), ''), '')) AS batter_team_code,
    CASE
      WHEN LOWER(TRIM(COALESCE(pe.pitcherthrows, ''))) IN ('r','right') THEN 'Right'
      WHEN LOWER(TRIM(COALESCE(pe.pitcherthrows, ''))) IN ('l','left') THEN 'Left'
      ELSE ''
    END AS pitcherthrows_norm,
    CASE
      WHEN LOWER(TRIM(COALESCE(pe.taggedpitchtype, ''))) IN ('fastball','sinker') THEN 'Fastballs'
      WHEN LOWER(TRIM(COALESCE(pe.taggedpitchtype, ''))) IN ('cutter','slider','sweeper','curveball') THEN 'Breaking Balls'
      WHEN LOWER(TRIM(COALESCE(pe.taggedpitchtype, ''))) IN ('changeup','splitter','forkball','screwball') THEN 'Off-Speed'
      ELSE 'Other'
    END AS pitch_group,
    COALESCE(NULLIF(TRIM(pe.taggedpitchtype), ''), 'Unknown') AS pitch_type,
    FLOOR((((NULLIF(BTRIM(pe.platelocside::text), '')::double precision) + 2.5) / 5.0) * 24.0)::smallint AS plate_x_bin,
    FLOOR((((NULLIF(BTRIM(pe.platelocheight::text), '')::double precision) - 0.0) / 5.0) * 30.0)::smallint AS plate_z_bin,
    COALESCE(pe.pitchcall, '') AS pitch_call,
    COALESCE(pe.playresult, '') AS play_result,
    COALESCE(pe.korbb, '') AS korbb,
    COALESCE(pe.taggedhittype, '') AS tagged_hit_type,
    COALESCE(pe.delta_pitcher_run_exp, 0.0) AS rv,
    COALESCE(pe.delta_pitcher_run_exp, 0.0) AS pv,
    pe.estimated_woba_using_speedangle AS xwoba,
    (NULLIF(TRIM(pe.exitspeed), '')::double precision) AS ev
  FROM public.pro_pitch_events pe
  WHERE pe.session_date IS NOT NULL
), agg AS (
  SELECT
    session_date,
    level_bucket,
    batter_norm,
    batter_team_code,
    pitcherthrows_norm,
    pitch_group,
    pitch_type,
    GREATEST(0, LEAST(23, plate_x_bin)) AS plate_x_bin,
    GREATEST(0, LEAST(29, plate_z_bin)) AS plate_z_bin,
    COUNT(*)::int AS pitch_n,
    SUM(CASE WHEN LOWER(pitch_call) IN ('strikeswinging','foulball','foulballnotfieldable','foulballfieldable','inplay') THEN 1 ELSE 0 END)::int AS swing_n,
    SUM(CASE WHEN LOWER(pitch_call) IN ('strikeswinging') THEN 1 ELSE 0 END)::int AS whiff_n,
    SUM(CASE WHEN LOWER(pitch_call)='inplay' THEN 1 ELSE 0 END)::int AS in_play_n,
    SUM(CASE WHEN LOWER(tagged_hit_type)='groundball' THEN 1 ELSE 0 END)::int AS gb_n,
    SUM(CASE WHEN LOWER(pitch_call)='strikecalled' THEN 1 ELSE 0 END)::int AS cs_n,
    SUM(CASE WHEN LOWER(pitch_call) IN ('strikecalled','ballcalled','ballindirt') THEN 1 ELSE 0 END)::int AS take_n,
    SUM(rv)::double precision AS rv_sum,
    SUM(pv)::double precision AS pv_sum,
    SUM(CASE WHEN xwoba IS NOT NULL THEN xwoba ELSE 0 END)::double precision AS xwoba_sum,
    SUM(CASE WHEN xwoba IS NOT NULL THEN 1 ELSE 0 END)::int AS xwoba_n,
    SUM(CASE WHEN ev IS NOT NULL THEN ev ELSE 0 END)::double precision AS ev_sum,
    SUM(CASE WHEN ev IS NOT NULL THEN 1 ELSE 0 END)::int AS ev_n
  FROM src
  WHERE batter_norm <> ''
    AND plate_x_bin IS NOT NULL
    AND plate_z_bin IS NOT NULL
  GROUP BY 1,2,3,4,5,6,7,8,9
)
INSERT INTO public.pro_hitting_heatmap_daily_bins (
  session_date, level_bucket, batter_norm, batter_team_code, pitcherthrows_norm,
  pitch_group, pitch_type, plate_x_bin, plate_z_bin,
  pitch_n, swing_n, whiff_n, in_play_n, gb_n, cs_n, take_n,
  rv_sum, pv_sum, xwoba_sum, xwoba_n, ev_sum, ev_n, updated_at
)
SELECT
  session_date, level_bucket, batter_norm, batter_team_code, pitcherthrows_norm,
  pitch_group, pitch_type, plate_x_bin, plate_z_bin,
  pitch_n, swing_n, whiff_n, in_play_n, gb_n, cs_n, take_n,
  rv_sum, pv_sum, xwoba_sum, xwoba_n, ev_sum, ev_n, NOW()
FROM agg
ON CONFLICT (
  session_date, level_bucket, batter_norm, batter_team_code, pitcherthrows_norm,
  pitch_group, pitch_type, plate_x_bin, plate_z_bin
)
DO UPDATE SET
  pitch_n = EXCLUDED.pitch_n,
  swing_n = EXCLUDED.swing_n,
  whiff_n = EXCLUDED.whiff_n,
  in_play_n = EXCLUDED.in_play_n,
  gb_n = EXCLUDED.gb_n,
  cs_n = EXCLUDED.cs_n,
  take_n = EXCLUDED.take_n,
  rv_sum = EXCLUDED.rv_sum,
  pv_sum = EXCLUDED.pv_sum,
  xwoba_sum = EXCLUDED.xwoba_sum,
  xwoba_n = EXCLUDED.xwoba_n,
  ev_sum = EXCLUDED.ev_sum,
  ev_n = EXCLUDED.ev_n,
  updated_at = NOW();
'''

def main():
    dsn = os.getenv('DATABASE_URL', '').strip()
    if not dsn:
        print('DATABASE_URL missing', file=sys.stderr)
        return 1
    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            with open('scripts/create_pro_hitting_heatmap_rollup.sql', 'r', encoding='utf-8') as f:
                cur.execute(f.read())
            cur.execute(SQL)
        conn.commit()
    print('ok: refreshed pro_hitting_heatmap_daily_bins')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
