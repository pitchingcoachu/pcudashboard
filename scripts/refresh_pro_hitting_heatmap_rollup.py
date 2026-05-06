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
    CASE
      WHEN GREATEST(0, LEAST(3, COALESCE((NULLIF(BTRIM(pe.balls::text), ''))::int, 0))) = 0
       AND GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pe.strikes::text), ''))::int, 0))) = 0 THEN '0-0'
      WHEN GREATEST(0, LEAST(3, COALESCE((NULLIF(BTRIM(pe.balls::text), ''))::int, 0))) = 1
       AND GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pe.strikes::text), ''))::int, 0))) = 1 THEN '1-1'
      WHEN GREATEST(0, LEAST(3, COALESCE((NULLIF(BTRIM(pe.balls::text), ''))::int, 0))) > GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pe.strikes::text), ''))::int, 0))) THEN 'Behind'
      WHEN GREATEST(0, LEAST(3, COALESCE((NULLIF(BTRIM(pe.balls::text), ''))::int, 0))) < GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pe.strikes::text), ''))::int, 0))) THEN 'Ahead'
      ELSE 'Even'
    END AS count_bucket,
    CASE
      WHEN REGEXP_REPLACE(LOWER(COALESCE(pe.korbb, '')), '[^a-z0-9]+', '', 'g') IN ('strikeout','walk','intentwalk','intentionalwalk','strikeoutdoubleplay')
        OR REGEXP_REPLACE(LOWER(COALESCE(pe.pitchcall, '')), '[^a-z0-9]+', '', 'g') IN ('inplayouts','inplaynoout','inplayruns','inplay','hitintoplay','hitbypitch')
      THEN 'PA End'
      WHEN LEAST(3, GREATEST(0, LEAST(3, COALESCE((NULLIF(BTRIM(pe.balls::text), ''))::int, 0))) + CASE WHEN REGEXP_REPLACE(LOWER(COALESCE(pe.pitchcall, '')), '[^a-z0-9]+', '', 'g') IN ('ball','ballcalled','ballindirt','ballintentional') THEN 1 ELSE 0 END)
         > LEAST(2, GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pe.strikes::text), ''))::int, 0))) + CASE WHEN REGEXP_REPLACE(LOWER(COALESCE(pe.pitchcall, '')), '[^a-z0-9]+', '', 'g') IN ('calledstrike','strikecalled','swingingstrike','swingingstrikeblocked','strikeswinging') OR (REGEXP_REPLACE(LOWER(COALESCE(pe.pitchcall, '')), '[^a-z0-9]+', '', 'g') IN ('foul','foultip','foulball','foulballfieldable','foulballnotfieldable') AND GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pe.strikes::text), ''))::int, 0))) < 2) THEN 1 ELSE 0 END)
      THEN 'Behind'
      WHEN LEAST(3, GREATEST(0, LEAST(3, COALESCE((NULLIF(BTRIM(pe.balls::text), ''))::int, 0))) + CASE WHEN REGEXP_REPLACE(LOWER(COALESCE(pe.pitchcall, '')), '[^a-z0-9]+', '', 'g') IN ('ball','ballcalled','ballindirt','ballintentional') THEN 1 ELSE 0 END)
         < LEAST(2, GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pe.strikes::text), ''))::int, 0))) + CASE WHEN REGEXP_REPLACE(LOWER(COALESCE(pe.pitchcall, '')), '[^a-z0-9]+', '', 'g') IN ('calledstrike','strikecalled','swingingstrike','swingingstrikeblocked','strikeswinging') OR (REGEXP_REPLACE(LOWER(COALESCE(pe.pitchcall, '')), '[^a-z0-9]+', '', 'g') IN ('foul','foultip','foulball','foulballfieldable','foulballnotfieldable') AND GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pe.strikes::text), ''))::int, 0))) < 2) THEN 1 ELSE 0 END)
      THEN 'Ahead'
      WHEN LEAST(3, GREATEST(0, LEAST(3, COALESCE((NULLIF(BTRIM(pe.balls::text), ''))::int, 0))) + CASE WHEN REGEXP_REPLACE(LOWER(COALESCE(pe.pitchcall, '')), '[^a-z0-9]+', '', 'g') IN ('ball','ballcalled','ballindirt','ballintentional') THEN 1 ELSE 0 END) = 1
       AND LEAST(2, GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pe.strikes::text), ''))::int, 0))) + CASE WHEN REGEXP_REPLACE(LOWER(COALESCE(pe.pitchcall, '')), '[^a-z0-9]+', '', 'g') IN ('calledstrike','strikecalled','swingingstrike','swingingstrikeblocked','strikeswinging') OR (REGEXP_REPLACE(LOWER(COALESCE(pe.pitchcall, '')), '[^a-z0-9]+', '', 'g') IN ('foul','foultip','foulball','foulballfieldable','foulballnotfieldable') AND GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pe.strikes::text), ''))::int, 0))) < 2) THEN 1 ELSE 0 END) = 1
      THEN '1-1'
      ELSE 'Even'
    END AS after_count_bucket,
    COALESCE(NULLIF(BTRIM(pe.inning::text), ''), 'Unknown') AS inning_bucket,
    FLOOR((((NULLIF(BTRIM(pe.platelocside::text), '')::double precision) + 2.5) / 5.0) * 24.0)::smallint AS plate_x_bin,
    FLOOR((((NULLIF(BTRIM(pe.platelocheight::text), '')::double precision) - 0.0) / 5.0) * 30.0)::smallint AS plate_z_bin,
    COALESCE(pe.pitchcall, '') AS pitch_call,
    COALESCE(pe.playresult, '') AS play_result,
    COALESCE(pe.korbb, '') AS korbb,
    REGEXP_REPLACE(LOWER(COALESCE(pe.pitchcall, '')), '[^a-z0-9]+', '_', 'g') AS pitch_call_norm,
    REGEXP_REPLACE(LOWER(COALESCE(pe.playresult, '')), '[^a-z0-9]+', '_', 'g') AS play_result_norm,
    REGEXP_REPLACE(LOWER(COALESCE(pe.korbb, '')), '[^a-z0-9]+', '_', 'g') AS korbb_norm,
    GREATEST(
      0,
      LEAST(3, COALESCE((NULLIF(BTRIM(pe.balls::text), ''))::int, 0))
    ) AS balls_num,
    GREATEST(
      0,
      LEAST(2, COALESCE((NULLIF(BTRIM(pe.strikes::text), ''))::int, 0))
    ) AS strikes_num,
    COALESCE(pe.taggedhittype, '') AS tagged_hit_type,
    -- Run Values use batter delta_run_exp with sign inverted for existing UI convention.
    COALESCE(pe.delta_run_exp, 0.0) * -1.0 AS rv,
    (
      CASE
        WHEN REGEXP_REPLACE(LOWER(COALESCE(pe.korbb, '')), '[^a-z0-9]+', '_', 'g') = 'strikeout'
          OR REGEXP_REPLACE(LOWER(COALESCE(pe.playresult, '')), '[^a-z0-9]+', '_', 'g') IN ('strikeout', 'strikeout_double_play', 'strikeoutdoubleplay')
          THEN (-0.18 + (0.35 * GREATEST(-0.08, LEAST(0.08, ((GREATEST(0, LEAST(3, COALESCE((NULLIF(BTRIM(pe.balls::text), ''))::int, 0))) - GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pe.strikes::text), ''))::int, 0)))) * 0.02))))) - 0.024
        WHEN REGEXP_REPLACE(LOWER(COALESCE(pe.korbb, '')), '[^a-z0-9]+', '_', 'g') = 'walk'
          OR REGEXP_REPLACE(LOWER(COALESCE(pe.playresult, '')), '[^a-z0-9]+', '_', 'g') IN ('walk', 'intentional_walk')
          THEN (0.36 + (0.35 * GREATEST(-0.08, LEAST(0.08, ((GREATEST(0, LEAST(3, COALESCE((NULLIF(BTRIM(pe.balls::text), ''))::int, 0))) - GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pe.strikes::text), ''))::int, 0)))) * 0.02))))) - 0.024
        WHEN REGEXP_REPLACE(LOWER(COALESCE(pe.pitchcall, '')), '[^a-z0-9]+', '_', 'g') = 'hit_by_pitch'
          OR REGEXP_REPLACE(LOWER(COALESCE(pe.playresult, '')), '[^a-z0-9]+', '_', 'g') = 'hit_by_pitch'
          THEN (0.34 + (0.35 * GREATEST(-0.08, LEAST(0.08, ((GREATEST(0, LEAST(3, COALESCE((NULLIF(BTRIM(pe.balls::text), ''))::int, 0))) - GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pe.strikes::text), ''))::int, 0)))) * 0.02))))) - 0.024
        WHEN REGEXP_REPLACE(LOWER(COALESCE(pe.pitchcall, '')), '[^a-z0-9]+', '_', 'g') IN ('in_play', 'inplay', 'in_play_out_s', 'in_play_no_out', 'in_play_run_s')
          OR REGEXP_REPLACE(LOWER(COALESCE(pe.playresult, '')), '[^a-z0-9]+', '_', 'g') <> ''
          THEN CASE
            WHEN REGEXP_REPLACE(LOWER(COALESCE(pe.playresult, '')), '[^a-z0-9]+', '_', 'g') = 'single' THEN 0.48 - 0.024
            WHEN REGEXP_REPLACE(LOWER(COALESCE(pe.playresult, '')), '[^a-z0-9]+', '_', 'g') = 'double' THEN 0.78 - 0.024
            WHEN REGEXP_REPLACE(LOWER(COALESCE(pe.playresult, '')), '[^a-z0-9]+', '_', 'g') = 'triple' THEN 1.09 - 0.024
            WHEN REGEXP_REPLACE(LOWER(COALESCE(pe.playresult, '')), '[^a-z0-9]+', '_', 'g') IN ('home_run', 'homerun') THEN 1.4 - 0.024
            WHEN REGEXP_REPLACE(LOWER(COALESCE(pe.playresult, '')), '[^a-z0-9]+', '_', 'g') IN ('field_error', 'error') THEN 0.33 - 0.024
            ELSE -0.1 - 0.024
          END
        WHEN REGEXP_REPLACE(LOWER(COALESCE(pe.pitchcall, '')), '[^a-z0-9]+', '_', 'g') IN ('ball', 'ballcalled', 'ball_in_dirt', 'ballindirt', 'ball_intentional')
          THEN (0.02 + (0.35 * GREATEST(-0.08, LEAST(0.08, ((GREATEST(0, LEAST(3, COALESCE((NULLIF(BTRIM(pe.balls::text), ''))::int, 0))) - GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pe.strikes::text), ''))::int, 0)))) * 0.02))))) - 0.024
        WHEN REGEXP_REPLACE(LOWER(COALESCE(pe.pitchcall, '')), '[^a-z0-9]+', '_', 'g') IN ('called_strike', 'strikecalled')
          THEN (-0.03 + (0.35 * GREATEST(-0.08, LEAST(0.08, ((GREATEST(0, LEAST(3, COALESCE((NULLIF(BTRIM(pe.balls::text), ''))::int, 0))) - GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pe.strikes::text), ''))::int, 0)))) * 0.02))))) - 0.024
        WHEN REGEXP_REPLACE(LOWER(COALESCE(pe.pitchcall, '')), '[^a-z0-9]+', '_', 'g') IN ('swinging_strike', 'swinging_strike_blocked', 'swinging_strike_pitchout', 'strikeswinging')
          THEN (-0.05 + (0.35 * GREATEST(-0.08, LEAST(0.08, ((GREATEST(0, LEAST(3, COALESCE((NULLIF(BTRIM(pe.balls::text), ''))::int, 0))) - GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pe.strikes::text), ''))::int, 0)))) * 0.02))))) - 0.024
        WHEN REGEXP_REPLACE(LOWER(COALESCE(pe.pitchcall, '')), '[^a-z0-9]+', '_', 'g') IN ('foul', 'foul_ball', 'foulball', 'foulballfieldable', 'foulballnotfieldable')
          THEN (
            (CASE WHEN GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pe.strikes::text), ''))::int, 0))) >= 2 THEN -0.005 ELSE -0.02 END)
            + (0.3 * GREATEST(-0.08, LEAST(0.08, ((GREATEST(0, LEAST(3, COALESCE((NULLIF(BTRIM(pe.balls::text), ''))::int, 0))) - GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pe.strikes::text), ''))::int, 0)))) * 0.02))))
            - 0.024
          )
        ELSE 0.0 - 0.024
      END
    ) AS pv,
    pe.estimated_woba_using_speedangle AS xwoba,
    pe.iso_value AS xiso,
    (NULLIF(BTRIM(pe.exitspeed::text), '')::double precision) AS ev,
    (NULLIF(BTRIM(pe.angle::text), '')::double precision) AS launch_angle
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
    count_bucket,
    after_count_bucket,
    inning_bucket,
    GREATEST(0, LEAST(23, plate_x_bin)) AS plate_x_bin,
    GREATEST(0, LEAST(29, plate_z_bin)) AS plate_z_bin,
    COUNT(*)::int AS pitch_n,
    SUM(
      CASE
        WHEN REGEXP_REPLACE(LOWER(COALESCE(pitch_call, '')), '[^a-z0-9]+', '', 'g') IN (
          'swingingstrike', 'swingingstrikeblocked', 'strikeswinging',
          'foul', 'foultip', 'foulbunt', 'foulball', 'foulballfieldable', 'foulballnotfieldable',
          'inplayouts', 'inplaynoout', 'inplayruns', 'inplay', 'hitintoplay'
        ) THEN 1
        ELSE 0
      END
    )::int AS swing_n,
    SUM(
      CASE
        WHEN REGEXP_REPLACE(LOWER(COALESCE(pitch_call, '')), '[^a-z0-9]+', '', 'g') IN (
          'swingingstrike', 'swingingstrikeblocked', 'strikeswinging', 'foultip', 'missedbunt'
        ) THEN 1
        ELSE 0
      END
    )::int AS whiff_n,
    SUM(
      CASE
        WHEN REGEXP_REPLACE(LOWER(COALESCE(pitch_call, '')), '[^a-z0-9]+', '', 'g') IN (
          'inplayouts', 'inplaynoout', 'inplayruns', 'inplay', 'hitintoplay'
        ) THEN 1
        ELSE 0
      END
    )::int AS in_play_n,
    SUM(
      CASE
        WHEN REGEXP_REPLACE(LOWER(COALESCE(tagged_hit_type, '')), '[^a-z0-9]+', '_', 'g') IN ('groundball', 'ground_ball')
          THEN 1
        WHEN launch_angle IS NOT NULL AND launch_angle <= 10 THEN 1
        ELSE 0
      END
    )::int AS gb_n,
    SUM(
      CASE
        WHEN REGEXP_REPLACE(LOWER(COALESCE(pitch_call, '')), '[^a-z0-9]+', '', 'g') IN ('calledstrike', 'strikecalled')
        THEN 1
        ELSE 0
      END
    )::int AS cs_n,
    SUM(
      CASE
        WHEN REGEXP_REPLACE(LOWER(COALESCE(pitch_call, '')), '[^a-z0-9]+', '', 'g') IN (
          'calledstrike', 'strikecalled', 'ball', 'ballcalled', 'ballindirt', 'pitchout', 'hitbypitch'
        ) THEN 1
        ELSE 0
      END
    )::int AS take_n,
    SUM(
      CASE
        WHEN REGEXP_REPLACE(LOWER(COALESCE(korbb, '')), '[^a-z0-9]+', '', 'g') IN ('strikeout','walk','intentwalk','intentionalwalk','strikeoutdoubleplay')
          OR REGEXP_REPLACE(LOWER(COALESCE(pitch_call, '')), '[^a-z0-9]+', '', 'g') IN ('inplayouts','inplaynoout','inplayruns','inplay','hitintoplay','hitbypitch')
        THEN 1
        ELSE 0
      END
    )::int AS pa_n,
    SUM(CASE WHEN plate_x_bin BETWEEN 7 AND 16 AND plate_z_bin BETWEEN 9 AND 21 THEN 1 ELSE 0 END)::int AS inzone_n,
    SUM(CASE WHEN balls_num = 0 AND strikes_num = 0 THEN 1 ELSE 0 END)::int AS fps_den,
    SUM(CASE WHEN balls_num = 0 AND strikes_num = 0 AND REGEXP_REPLACE(LOWER(COALESCE(pitch_call, '')), '[^a-z0-9]+', '', 'g') IN ('calledstrike','strikecalled','swingingstrike','swingingstrikeblocked','strikeswinging','foul','foultip','foulbunt','foulball','foulballfieldable','foulballnotfieldable','inplayouts','inplaynoout','inplayruns','inplay','hitintoplay') THEN 1 ELSE 0 END)::int AS fps_num,
    SUM(CASE WHEN balls_num = 0 AND strikes_num = 0 AND LOWER(COALESCE(pitch_group,''))='fastballs' THEN 1 ELSE 0 END)::int AS fps_fb_den,
    SUM(CASE WHEN balls_num = 0 AND strikes_num = 0 AND LOWER(COALESCE(pitch_group,''))='fastballs' AND REGEXP_REPLACE(LOWER(COALESCE(pitch_call, '')), '[^a-z0-9]+', '', 'g') IN ('swingingstrike','swingingstrikeblocked','strikeswinging','foul','foultip','foulbunt','foulball','foulballfieldable','foulballnotfieldable','inplayouts','inplaynoout','inplayruns','inplay','hitintoplay') THEN 1 ELSE 0 END)::int AS fps_fb_num,
    SUM(CASE WHEN balls_num = 0 AND strikes_num = 0 AND LOWER(COALESCE(pitch_group,''))='off-speed' THEN 1 ELSE 0 END)::int AS fps_os_den,
    SUM(CASE WHEN balls_num = 0 AND strikes_num = 0 AND LOWER(COALESCE(pitch_group,''))='off-speed' AND REGEXP_REPLACE(LOWER(COALESCE(pitch_call, '')), '[^a-z0-9]+', '', 'g') IN ('swingingstrike','swingingstrikeblocked','strikeswinging','foul','foultip','foulbunt','foulball','foulballfieldable','foulballnotfieldable','inplayouts','inplaynoout','inplayruns','inplay','hitintoplay') THEN 1 ELSE 0 END)::int AS fps_os_num,
    SUM(CASE WHEN NOT (plate_x_bin BETWEEN 7 AND 16 AND plate_z_bin BETWEEN 9 AND 21) AND REGEXP_REPLACE(LOWER(COALESCE(pitch_call, '')), '[^a-z0-9]+', '', 'g') IN ('swingingstrike','swingingstrikeblocked','strikeswinging','foul','foultip','foulbunt','foulball','foulballfieldable','foulballnotfieldable','inplayouts','inplaynoout','inplayruns','inplay','hitintoplay') THEN 1 ELSE 0 END)::int AS chase_n,
    SUM(CASE WHEN REGEXP_REPLACE(LOWER(COALESCE(play_result, '')), '[^a-z0-9]+', '', 'g') IN ('single','double','triple','homerun','homer') THEN 1 ELSE 0 END)::int AS h_n,
    SUM(CASE WHEN REGEXP_REPLACE(LOWER(COALESCE(play_result, '')), '[^a-z0-9]+', '', 'g') IN ('double','triple','homerun','homer') THEN 1 ELSE 0 END)::int AS xbh_n,
    SUM(CASE WHEN REGEXP_REPLACE(LOWER(COALESCE(play_result, '')), '[^a-z0-9]+', '', 'g') IN ('homerun','homer') THEN 1 ELSE 0 END)::int AS hr_n,
    SUM(CASE WHEN REGEXP_REPLACE(LOWER(COALESCE(pitch_call, '')), '[^a-z0-9]+', '', 'g') IN ('hitbypitch') OR REGEXP_REPLACE(LOWER(COALESCE(play_result, '')), '[^a-z0-9]+', '', 'g') IN ('hitbypitch') THEN 1 ELSE 0 END)::int AS hbp_n,
    SUM(CASE WHEN REGEXP_REPLACE(LOWER(COALESCE(korbb, '')), '[^a-z0-9]+', '', 'g') IN ('strikeout','strikeoutdoubleplay') THEN 1 ELSE 0 END)::int AS k_n,
    SUM(CASE WHEN REGEXP_REPLACE(LOWER(COALESCE(korbb, '')), '[^a-z0-9]+', '', 'g') IN ('walk','intentwalk','intentionalwalk') THEN 1 ELSE 0 END)::int AS bb_n,
    SUM(
      CASE
        WHEN REGEXP_REPLACE(LOWER(COALESCE(pitch_call, '')), '[^a-z0-9]+', '', 'g') IN ('inplayouts','inplaynoout','inplayruns','inplay','hitintoplay')
          AND ev IS NOT NULL
          AND launch_angle IS NOT NULL
          AND ev >= 95.0
          AND launch_angle BETWEEN 10.0 AND 35.0
        THEN 1
        ELSE 0
      END
    )::int AS barrel_n,
    SUM(CASE WHEN xiso IS NOT NULL THEN xiso ELSE 0 END)::double precision AS xiso_sum,
    SUM(CASE WHEN xiso IS NOT NULL THEN 1 ELSE 0 END)::int AS xiso_n,
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
  GROUP BY 1,2,3,4,5,6,7,8,9,10,11,12
)
INSERT INTO public.pro_hitting_heatmap_daily_bins (
  session_date, level_bucket, batter_norm, batter_team_code, pitcherthrows_norm,
  pitch_group, pitch_type, count_bucket, after_count_bucket, inning_bucket, plate_x_bin, plate_z_bin,
  pitch_n, swing_n, whiff_n, in_play_n, gb_n, cs_n, take_n,
  pa_n, inzone_n, fps_den, fps_num, fps_fb_den, fps_fb_num, fps_os_den, fps_os_num, chase_n,
  h_n, xbh_n, hr_n, hbp_n, k_n, bb_n, barrel_n, xiso_sum, xiso_n,
  rv_sum, pv_sum, xwoba_sum, xwoba_n, ev_sum, ev_n, updated_at
)
SELECT
  session_date, level_bucket, batter_norm, batter_team_code, pitcherthrows_norm,
  pitch_group, pitch_type, count_bucket, after_count_bucket, inning_bucket, plate_x_bin, plate_z_bin,
  pitch_n, swing_n, whiff_n, in_play_n, gb_n, cs_n, take_n,
  pa_n, inzone_n, fps_den, fps_num, fps_fb_den, fps_fb_num, fps_os_den, fps_os_num, chase_n,
  h_n, xbh_n, hr_n, hbp_n, k_n, bb_n, barrel_n, xiso_sum, xiso_n,
  rv_sum, pv_sum, xwoba_sum, xwoba_n, ev_sum, ev_n, NOW()
FROM agg
ON CONFLICT (
  session_date, level_bucket, batter_norm, batter_team_code, pitcherthrows_norm,
  pitch_group, pitch_type, count_bucket, after_count_bucket, inning_bucket, plate_x_bin, plate_z_bin
)
DO UPDATE SET
  pitch_n = EXCLUDED.pitch_n,
  swing_n = EXCLUDED.swing_n,
  whiff_n = EXCLUDED.whiff_n,
  in_play_n = EXCLUDED.in_play_n,
  gb_n = EXCLUDED.gb_n,
  cs_n = EXCLUDED.cs_n,
  take_n = EXCLUDED.take_n,
  pa_n = EXCLUDED.pa_n,
  inzone_n = EXCLUDED.inzone_n,
  fps_den = EXCLUDED.fps_den,
  fps_num = EXCLUDED.fps_num,
  fps_fb_den = EXCLUDED.fps_fb_den,
  fps_fb_num = EXCLUDED.fps_fb_num,
  fps_os_den = EXCLUDED.fps_os_den,
  fps_os_num = EXCLUDED.fps_os_num,
  chase_n = EXCLUDED.chase_n,
  h_n = EXCLUDED.h_n,
  xbh_n = EXCLUDED.xbh_n,
  hr_n = EXCLUDED.hr_n,
  hbp_n = EXCLUDED.hbp_n,
  k_n = EXCLUDED.k_n,
  bb_n = EXCLUDED.bb_n,
  barrel_n = EXCLUDED.barrel_n,
  xiso_sum = EXCLUDED.xiso_sum,
  xiso_n = EXCLUDED.xiso_n,
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
