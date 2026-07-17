#!/usr/bin/env python3
import os
import sys
import psycopg

SQL = r'''
WITH base_non_pro AS (
  SELECT
    pe.session_date::date AS session_date,
    UPPER(COALESCE(NULLIF(TRIM(pe.school_code), ''), '')) AS school_code,
    UPPER(COALESCE(NULLIF(TRIM(pe.session_type), ''), '')) AS session_type_bucket,
    LOWER(TRIM(COALESCE(pe.pitcher, ''))) AS pitcher_norm,
    UPPER(COALESCE(NULLIF(TRIM(pe.pitcherteam), ''), '')) AS pitcher_team_code,
    CASE
      WHEN LOWER(TRIM(COALESCE(pe.pitcherthrows, ''))) IN ('r','right') THEN 'Right'
      WHEN LOWER(TRIM(COALESCE(pe.pitcherthrows, ''))) IN ('l','left') THEN 'Left'
      ELSE ''
    END AS pitcherhand_norm,
    CASE
      WHEN LOWER(TRIM(COALESCE(pe.batterside, ''))) IN ('r','right') THEN 'Right'
      WHEN LOWER(TRIM(COALESCE(pe.batterside, ''))) IN ('l','left') THEN 'Left'
      ELSE ''
    END AS batterside_norm,
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
      WHEN LEAST(3, GREATEST(0, LEAST(3, COALESCE((NULLIF(BTRIM(pe.balls::text), ''))::int, 0))) + CASE WHEN REGEXP_REPLACE(LOWER(COALESCE(pe.pitchcall, '')), '[^a-z0-9]+', '', 'g') IN ('ball','ballcalled','ballindirt','ballintentional') THEN 1 ELSE 0 END) = 0
       AND LEAST(2, GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pe.strikes::text), ''))::int, 0))) + CASE WHEN REGEXP_REPLACE(LOWER(COALESCE(pe.pitchcall, '')), '[^a-z0-9]+', '', 'g') IN ('calledstrike','strikecalled','swingingstrike','swingingstrikeblocked','strikeswinging') OR (REGEXP_REPLACE(LOWER(COALESCE(pe.pitchcall, '')), '[^a-z0-9]+', '', 'g') IN ('foul','foultip','foulball','foulballfieldable','foulballnotfieldable') AND GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pe.strikes::text), ''))::int, 0))) < 2) THEN 1 ELSE 0 END) = 0 THEN '0-0'
      WHEN LEAST(3, GREATEST(0, LEAST(3, COALESCE((NULLIF(BTRIM(pe.balls::text), ''))::int, 0))) + CASE WHEN REGEXP_REPLACE(LOWER(COALESCE(pe.pitchcall, '')), '[^a-z0-9]+', '', 'g') IN ('ball','ballcalled','ballindirt','ballintentional') THEN 1 ELSE 0 END) = 1
       AND LEAST(2, GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pe.strikes::text), ''))::int, 0))) + CASE WHEN REGEXP_REPLACE(LOWER(COALESCE(pe.pitchcall, '')), '[^a-z0-9]+', '', 'g') IN ('calledstrike','strikecalled','swingingstrike','swingingstrikeblocked','strikeswinging') OR (REGEXP_REPLACE(LOWER(COALESCE(pe.pitchcall, '')), '[^a-z0-9]+', '', 'g') IN ('foul','foultip','foulball','foulballfieldable','foulballnotfieldable') AND GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pe.strikes::text), ''))::int, 0))) < 2) THEN 1 ELSE 0 END) = 1 THEN '1-1'
      WHEN LEAST(3, GREATEST(0, LEAST(3, COALESCE((NULLIF(BTRIM(pe.balls::text), ''))::int, 0))) + CASE WHEN REGEXP_REPLACE(LOWER(COALESCE(pe.pitchcall, '')), '[^a-z0-9]+', '', 'g') IN ('ball','ballcalled','ballindirt','ballintentional') THEN 1 ELSE 0 END)
         > LEAST(2, GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pe.strikes::text), ''))::int, 0))) + CASE WHEN REGEXP_REPLACE(LOWER(COALESCE(pe.pitchcall, '')), '[^a-z0-9]+', '', 'g') IN ('calledstrike','strikecalled','swingingstrike','swingingstrikeblocked','strikeswinging') OR (REGEXP_REPLACE(LOWER(COALESCE(pe.pitchcall, '')), '[^a-z0-9]+', '', 'g') IN ('foul','foultip','foulball','foulballfieldable','foulballnotfieldable') AND GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pe.strikes::text), ''))::int, 0))) < 2) THEN 1 ELSE 0 END)
      THEN 'Behind'
      WHEN LEAST(3, GREATEST(0, LEAST(3, COALESCE((NULLIF(BTRIM(pe.balls::text), ''))::int, 0))) + CASE WHEN REGEXP_REPLACE(LOWER(COALESCE(pe.pitchcall, '')), '[^a-z0-9]+', '', 'g') IN ('ball','ballcalled','ballindirt','ballintentional') THEN 1 ELSE 0 END)
         < LEAST(2, GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pe.strikes::text), ''))::int, 0))) + CASE WHEN REGEXP_REPLACE(LOWER(COALESCE(pe.pitchcall, '')), '[^a-z0-9]+', '', 'g') IN ('calledstrike','strikecalled','swingingstrike','swingingstrikeblocked','strikeswinging') OR (REGEXP_REPLACE(LOWER(COALESCE(pe.pitchcall, '')), '[^a-z0-9]+', '', 'g') IN ('foul','foultip','foulball','foulballfieldable','foulballnotfieldable') AND GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pe.strikes::text), ''))::int, 0))) < 2) THEN 1 ELSE 0 END)
      THEN 'Ahead'
      ELSE 'Even'
    END AS after_count_bucket,
    COALESCE(NULLIF(BTRIM(pe.inning::text), ''), 'Unknown') AS inning_bucket,
    FLOOR((((NULLIF(BTRIM(pe.platelocside::text), '')::double precision) + 2.5) / 5.0) * 24.0)::smallint AS plate_x_bin,
    FLOOR((((NULLIF(BTRIM(pe.platelocheight::text), '')::double precision) - 0.0) / 5.0) * 30.0)::smallint AS plate_z_bin,
    COALESCE(pe.pitchcall, '') AS pitch_call,
    COALESCE(pe.playresult, '') AS play_result,
    COALESCE(pe.korbb, '') AS korbb,
    COALESCE(pe.taggedhittype, '') AS tagged_hit_type,
    GREATEST(0, LEAST(3, COALESCE((NULLIF(BTRIM(pe.balls::text), ''))::int, 0))) AS balls_num,
    GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pe.strikes::text), ''))::int, 0))) AS strikes_num,
    (
      CASE
        WHEN COALESCE(pe.korbb, '') = 'Strikeout' THEN -0.27
        WHEN COALESCE(pe.korbb, '') = 'Walk' THEN 0.33
        WHEN COALESCE(pe.pitchcall, '') IN ('BallCalled', 'BallinDirt', 'BallIntentional') THEN 0.03
        WHEN COALESCE(pe.pitchcall, '') IN ('StrikeCalled', 'StrikeSwinging', 'FoulBall', 'FoulBallFieldable', 'FoulBallNotFieldable') THEN -0.03
        WHEN COALESCE(pe.pitchcall, '') = 'InPlay' THEN
          CASE
            WHEN COALESCE(pe.playresult, '') = 'Single' THEN 0.47
            WHEN COALESCE(pe.playresult, '') = 'Double' THEN 0.78
            WHEN COALESCE(pe.playresult, '') = 'Triple' THEN 1.09
            WHEN COALESCE(pe.playresult, '') = 'HomeRun' THEN 1.4
            WHEN COALESCE(pe.playresult, '') = 'Error' THEN 0.33
            ELSE -0.27
          END
        ELSE 0.0
      END
    ) AS rv,
    (
      CASE
        WHEN REGEXP_REPLACE(LOWER(COALESCE(pe.korbb, '')), '[^a-z0-9]+', '_', 'g') = 'strikeout'
          OR REGEXP_REPLACE(LOWER(COALESCE(pe.playresult, '')), '[^a-z0-9]+', '_', 'g') IN ('strikeout', 'strikeout_double_play', 'strikeoutdoubleplay')
          THEN (-0.18 + (0.35 * GREATEST(-0.08, LEAST(0.08, ((GREATEST(0, LEAST(3, COALESCE((NULLIF(BTRIM(pe.balls::text), ''))::int, 0))) - GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pe.strikes::text), ''))::int, 0)))) * 0.02))))) - 0.031
        WHEN REGEXP_REPLACE(LOWER(COALESCE(pe.korbb, '')), '[^a-z0-9]+', '_', 'g') = 'walk'
          OR REGEXP_REPLACE(LOWER(COALESCE(pe.playresult, '')), '[^a-z0-9]+', '_', 'g') IN ('walk', 'intentional_walk')
          THEN (0.36 + (0.35 * GREATEST(-0.08, LEAST(0.08, ((GREATEST(0, LEAST(3, COALESCE((NULLIF(BTRIM(pe.balls::text), ''))::int, 0))) - GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pe.strikes::text), ''))::int, 0)))) * 0.02))))) - 0.031
        WHEN REGEXP_REPLACE(LOWER(COALESCE(pe.pitchcall, '')), '[^a-z0-9]+', '_', 'g') = 'hit_by_pitch'
          OR REGEXP_REPLACE(LOWER(COALESCE(pe.playresult, '')), '[^a-z0-9]+', '_', 'g') = 'hit_by_pitch'
          THEN (0.34 + (0.35 * GREATEST(-0.08, LEAST(0.08, ((GREATEST(0, LEAST(3, COALESCE((NULLIF(BTRIM(pe.balls::text), ''))::int, 0))) - GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pe.strikes::text), ''))::int, 0)))) * 0.02))))) - 0.031
        WHEN REGEXP_REPLACE(LOWER(COALESCE(pe.pitchcall, '')), '[^a-z0-9]+', '_', 'g') IN ('in_play', 'inplay', 'in_play_out_s', 'in_play_no_out', 'in_play_run_s')
          OR REGEXP_REPLACE(LOWER(COALESCE(pe.playresult, '')), '[^a-z0-9]+', '_', 'g') IN ('single', 'double', 'triple', 'home_run', 'homerun', 'field_error', 'error', 'out', 'fielders_choice', 'fielderschoice', 'sacrifice', 'double_play', 'doubleplay', 'triple_play', 'tripleplay')
          THEN CASE
            WHEN REGEXP_REPLACE(LOWER(COALESCE(pe.playresult, '')), '[^a-z0-9]+', '_', 'g') = 'single' THEN 0.48 - 0.031
            WHEN REGEXP_REPLACE(LOWER(COALESCE(pe.playresult, '')), '[^a-z0-9]+', '_', 'g') = 'double' THEN 0.78 - 0.031
            WHEN REGEXP_REPLACE(LOWER(COALESCE(pe.playresult, '')), '[^a-z0-9]+', '_', 'g') = 'triple' THEN 1.09 - 0.031
            WHEN REGEXP_REPLACE(LOWER(COALESCE(pe.playresult, '')), '[^a-z0-9]+', '_', 'g') IN ('home_run', 'homerun') THEN 1.4 - 0.031
            WHEN REGEXP_REPLACE(LOWER(COALESCE(pe.playresult, '')), '[^a-z0-9]+', '_', 'g') IN ('field_error', 'error') THEN 0.33 - 0.031
            ELSE -0.1 - 0.031
          END
        WHEN REGEXP_REPLACE(LOWER(COALESCE(pe.pitchcall, '')), '[^a-z0-9]+', '_', 'g') IN ('ball', 'ballcalled', 'ball_in_dirt', 'ballindirt', 'ball_intentional')
          THEN (0.02 + (0.35 * GREATEST(-0.08, LEAST(0.08, ((GREATEST(0, LEAST(3, COALESCE((NULLIF(BTRIM(pe.balls::text), ''))::int, 0))) - GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pe.strikes::text), ''))::int, 0)))) * 0.02))))) - 0.031
        WHEN REGEXP_REPLACE(LOWER(COALESCE(pe.pitchcall, '')), '[^a-z0-9]+', '_', 'g') IN ('called_strike', 'strikecalled')
          THEN (-0.03 + (0.35 * GREATEST(-0.08, LEAST(0.08, ((GREATEST(0, LEAST(3, COALESCE((NULLIF(BTRIM(pe.balls::text), ''))::int, 0))) - GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pe.strikes::text), ''))::int, 0)))) * 0.02))))) - 0.031
        WHEN REGEXP_REPLACE(LOWER(COALESCE(pe.pitchcall, '')), '[^a-z0-9]+', '_', 'g') IN ('swinging_strike', 'swinging_strike_blocked', 'swinging_strike_pitchout', 'strikeswinging')
          THEN (-0.05 + (0.35 * GREATEST(-0.08, LEAST(0.08, ((GREATEST(0, LEAST(3, COALESCE((NULLIF(BTRIM(pe.balls::text), ''))::int, 0))) - GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pe.strikes::text), ''))::int, 0)))) * 0.02))))) - 0.031
        WHEN REGEXP_REPLACE(LOWER(COALESCE(pe.pitchcall, '')), '[^a-z0-9]+', '_', 'g') IN ('foul', 'foul_ball', 'foulball', 'foulballfieldable', 'foulballnotfieldable')
          THEN (
            (CASE WHEN GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pe.strikes::text), ''))::int, 0))) >= 2 THEN -0.005 ELSE -0.02 END)
            + (0.3 * GREATEST(-0.08, LEAST(0.08, ((GREATEST(0, LEAST(3, COALESCE((NULLIF(BTRIM(pe.balls::text), ''))::int, 0))) - GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pe.strikes::text), ''))::int, 0)))) * 0.02))))
            - 0.031
          )
        ELSE 0.0 - 0.031
      END
    ) AS pv,
    0.0::double precision AS xwoba,
    0::int AS xwoba_n,
    0.0::double precision AS xiso,
    0::int AS xiso_n,
    (NULLIF(BTRIM(pe.relspeed::text), '')::double precision) AS relspeed,
    (NULLIF(BTRIM(pe.inducedvertbreak::text), '')::double precision) AS ivb,
    (NULLIF(BTRIM(pe.horzbreak::text), '')::double precision) AS hb,
    (NULLIF(BTRIM(pe.spinrate::text), '')::double precision) AS spinrate,
    (NULLIF(BTRIM(pe.relheight::text), '')::double precision) AS relheight,
    (NULLIF(BTRIM(pe.relside::text), '')::double precision) AS relside,
    (NULLIF(BTRIM(pe.extension::text), '')::double precision) AS ext,
    (NULLIF(BTRIM(pe.releasetilt::text), '')::double precision) AS releasetilt,
    (NULLIF(BTRIM(pe.exitspeed::text), '')::double precision) AS ev,
    (NULLIF(BTRIM(pe.angle::text), '')::double precision) AS launch_angle
  FROM public.pitch_events pe
  WHERE pe.session_date IS NOT NULL
    AND UPPER(COALESCE(NULLIF(TRIM(pe.school_code), ''), '')) <> 'PRO'
    AND REGEXP_REPLACE(LOWER(COALESCE(NULLIF(TRIM(pe.taggedpitchtype), ''), 'undefined')), '[^a-z0-9]', '', 'g') NOT IN ('', 'unknown', 'undefined', 'other', 'untagged', 'na', 'none', 'null')
), base_pro AS (
  SELECT
    pe.session_date::date AS session_date,
    'PRO'::text AS school_code,
    UPPER(COALESCE(NULLIF(TRIM(pe.session_type), ''), '')) AS session_type_bucket,
    LOWER(TRIM(COALESCE(pe.pitcher, ''))) AS pitcher_norm,
    UPPER(COALESCE(NULLIF(TRIM(pe.pitcherteam), ''), '')) AS pitcher_team_code,
    CASE
      WHEN LOWER(TRIM(COALESCE(pe.pitcherthrows, ''))) IN ('r','right') THEN 'Right'
      WHEN LOWER(TRIM(COALESCE(pe.pitcherthrows, ''))) IN ('l','left') THEN 'Left'
      ELSE ''
    END AS pitcherhand_norm,
    CASE
      WHEN LOWER(TRIM(COALESCE(pe.batterside, ''))) IN ('r','right') THEN 'Right'
      WHEN LOWER(TRIM(COALESCE(pe.batterside, ''))) IN ('l','left') THEN 'Left'
      ELSE ''
    END AS batterside_norm,
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
      WHEN LEAST(3, GREATEST(0, LEAST(3, COALESCE((NULLIF(BTRIM(pe.balls::text), ''))::int, 0))) + CASE WHEN REGEXP_REPLACE(LOWER(COALESCE(pe.pitchcall, '')), '[^a-z0-9]+', '', 'g') IN ('ball','ballcalled','ballindirt','ballintentional') THEN 1 ELSE 0 END) = 0
       AND LEAST(2, GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pe.strikes::text), ''))::int, 0))) + CASE WHEN REGEXP_REPLACE(LOWER(COALESCE(pe.pitchcall, '')), '[^a-z0-9]+', '', 'g') IN ('calledstrike','strikecalled','swingingstrike','swingingstrikeblocked','strikeswinging') OR (REGEXP_REPLACE(LOWER(COALESCE(pe.pitchcall, '')), '[^a-z0-9]+', '', 'g') IN ('foul','foultip','foulball','foulballfieldable','foulballnotfieldable') AND GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pe.strikes::text), ''))::int, 0))) < 2) THEN 1 ELSE 0 END) = 0 THEN '0-0'
      WHEN LEAST(3, GREATEST(0, LEAST(3, COALESCE((NULLIF(BTRIM(pe.balls::text), ''))::int, 0))) + CASE WHEN REGEXP_REPLACE(LOWER(COALESCE(pe.pitchcall, '')), '[^a-z0-9]+', '', 'g') IN ('ball','ballcalled','ballindirt','ballintentional') THEN 1 ELSE 0 END) = 1
       AND LEAST(2, GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pe.strikes::text), ''))::int, 0))) + CASE WHEN REGEXP_REPLACE(LOWER(COALESCE(pe.pitchcall, '')), '[^a-z0-9]+', '', 'g') IN ('calledstrike','strikecalled','swingingstrike','swingingstrikeblocked','strikeswinging') OR (REGEXP_REPLACE(LOWER(COALESCE(pe.pitchcall, '')), '[^a-z0-9]+', '', 'g') IN ('foul','foultip','foulball','foulballfieldable','foulballnotfieldable') AND GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pe.strikes::text), ''))::int, 0))) < 2) THEN 1 ELSE 0 END) = 1 THEN '1-1'
      WHEN LEAST(3, GREATEST(0, LEAST(3, COALESCE((NULLIF(BTRIM(pe.balls::text), ''))::int, 0))) + CASE WHEN REGEXP_REPLACE(LOWER(COALESCE(pe.pitchcall, '')), '[^a-z0-9]+', '', 'g') IN ('ball','ballcalled','ballindirt','ballintentional') THEN 1 ELSE 0 END)
         > LEAST(2, GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pe.strikes::text), ''))::int, 0))) + CASE WHEN REGEXP_REPLACE(LOWER(COALESCE(pe.pitchcall, '')), '[^a-z0-9]+', '', 'g') IN ('calledstrike','strikecalled','swingingstrike','swingingstrikeblocked','strikeswinging') OR (REGEXP_REPLACE(LOWER(COALESCE(pe.pitchcall, '')), '[^a-z0-9]+', '', 'g') IN ('foul','foultip','foulball','foulballfieldable','foulballnotfieldable') AND GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pe.strikes::text), ''))::int, 0))) < 2) THEN 1 ELSE 0 END)
      THEN 'Behind'
      WHEN LEAST(3, GREATEST(0, LEAST(3, COALESCE((NULLIF(BTRIM(pe.balls::text), ''))::int, 0))) + CASE WHEN REGEXP_REPLACE(LOWER(COALESCE(pe.pitchcall, '')), '[^a-z0-9]+', '', 'g') IN ('ball','ballcalled','ballindirt','ballintentional') THEN 1 ELSE 0 END)
         < LEAST(2, GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pe.strikes::text), ''))::int, 0))) + CASE WHEN REGEXP_REPLACE(LOWER(COALESCE(pe.pitchcall, '')), '[^a-z0-9]+', '', 'g') IN ('calledstrike','strikecalled','swingingstrike','swingingstrikeblocked','strikeswinging') OR (REGEXP_REPLACE(LOWER(COALESCE(pe.pitchcall, '')), '[^a-z0-9]+', '', 'g') IN ('foul','foultip','foulball','foulballfieldable','foulballnotfieldable') AND GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pe.strikes::text), ''))::int, 0))) < 2) THEN 1 ELSE 0 END)
      THEN 'Ahead'
      ELSE 'Even'
    END AS after_count_bucket,
    COALESCE(NULLIF(BTRIM(pe.inning::text), ''), 'Unknown') AS inning_bucket,
    FLOOR((((NULLIF(BTRIM(pe.platelocside::text), '')::double precision) + 2.5) / 5.0) * 24.0)::smallint AS plate_x_bin,
    FLOOR((((NULLIF(BTRIM(pe.platelocheight::text), '')::double precision) - 0.0) / 5.0) * 30.0)::smallint AS plate_z_bin,
    COALESCE(pe.pitchcall, '') AS pitch_call,
    COALESCE(pe.playresult, '') AS play_result,
    COALESCE(pe.korbb, '') AS korbb,
    COALESCE(pe.taggedhittype, '') AS tagged_hit_type,
    GREATEST(0, LEAST(3, COALESCE((NULLIF(BTRIM(pe.balls::text), ''))::int, 0))) AS balls_num,
    GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pe.strikes::text), ''))::int, 0))) AS strikes_num,
    COALESCE(pe.delta_pitcher_run_exp, COALESCE(pe.delta_run_exp, 0.0) * -1.0) AS rv,
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
          OR REGEXP_REPLACE(LOWER(COALESCE(pe.playresult, '')), '[^a-z0-9]+', '_', 'g') IN ('single', 'double', 'triple', 'home_run', 'homerun', 'field_error', 'error', 'out', 'fielders_choice', 'fielderschoice', 'sacrifice', 'double_play', 'doubleplay', 'triple_play', 'tripleplay')
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
    COALESCE(
      pe.estimated_woba_using_speedangle,
      CASE
        WHEN (NULLIF(BTRIM(pe.exitspeed::text), '')::double precision) IS NOT NULL
         AND (NULLIF(BTRIM(pe.angle::text), '')::double precision) IS NOT NULL
        THEN LEAST(
          1.2,
          GREATEST(
            0.0,
            0.15
            + (GREATEST(0.0, (NULLIF(BTRIM(pe.exitspeed::text), '')::double precision) - 70.0) / 50.0) * 0.9
            + (GREATEST(-10.0, LEAST(50.0, (NULLIF(BTRIM(pe.angle::text), '')::double precision))) + 10.0) / 60.0 * 0.25
          )
        )
        ELSE NULL
      END,
      0.0
    )::double precision AS xwoba,
    CASE
      WHEN pe.estimated_woba_using_speedangle IS NOT NULL THEN 1
      WHEN (NULLIF(BTRIM(pe.exitspeed::text), '')::double precision) IS NOT NULL
       AND (NULLIF(BTRIM(pe.angle::text), '')::double precision) IS NOT NULL THEN 1
      ELSE 0
    END AS xwoba_n,
    COALESCE(
      CASE
        WHEN (NULLIF(BTRIM(pe.exitspeed::text), '')::double precision) IS NOT NULL
         AND (NULLIF(BTRIM(pe.angle::text), '')::double precision) IS NOT NULL
        THEN CASE
          WHEN (NULLIF(BTRIM(pe.angle::text), '')::double precision) > 0
          THEN GREATEST(
            0.0,
            LEAST(
              1.2,
              ((GREATEST(0.0, (NULLIF(BTRIM(pe.exitspeed::text), '')::double precision) - 70.0)) / 35.0)
              * ((NULLIF(BTRIM(pe.angle::text), '')::double precision) / 35.0)
            )
          )
          ELSE 0.0
        END
        ELSE NULL
      END,
      0.0
    )::double precision AS xiso,
    CASE
      WHEN (NULLIF(BTRIM(pe.exitspeed::text), '')::double precision) IS NOT NULL
       AND (NULLIF(BTRIM(pe.angle::text), '')::double precision) IS NOT NULL THEN 1
      ELSE 0
    END AS xiso_n,
    (NULLIF(BTRIM(pe.relspeed::text), '')::double precision) AS relspeed,
    (NULLIF(BTRIM(pe.inducedvertbreak::text), '')::double precision) AS ivb,
    (NULLIF(BTRIM(pe.horzbreak::text), '')::double precision) AS hb,
    (NULLIF(BTRIM(pe.spinrate::text), '')::double precision) AS spinrate,
    (NULLIF(BTRIM(pe.relheight::text), '')::double precision) AS relheight,
    (NULLIF(BTRIM(pe.relside::text), '')::double precision) AS relside,
    (NULLIF(BTRIM(pe.extension::text), '')::double precision) AS ext,
    (NULLIF(BTRIM(pe.releasetilt::text), '')::double precision) AS releasetilt,
    (NULLIF(BTRIM(pe.exitspeed::text), '')::double precision) AS ev,
    (NULLIF(BTRIM(pe.angle::text), '')::double precision) AS launch_angle
  FROM public.pro_pitch_events pe
  WHERE pe.session_date IS NOT NULL
    AND REGEXP_REPLACE(LOWER(COALESCE(NULLIF(TRIM(pe.taggedpitchtype), ''), 'undefined')), '[^a-z0-9]', '', 'g') NOT IN ('', 'unknown', 'undefined', 'other', 'untagged', 'na', 'none', 'null')
), src AS (
  SELECT * FROM base_non_pro
  UNION ALL
  SELECT * FROM base_pro
), plus_src AS (
  SELECT
    pd."Date"::date AS session_date,
    'PRO'::text AS school_code,
    UPPER(COALESCE(NULLIF(TRIM(pd."SessionType"), ''), '')) AS session_type_bucket,
    LOWER(TRIM(COALESCE(pd."Pitcher", ''))) AS pitcher_norm,
    UPPER(COALESCE(NULLIF(TRIM(pd."PitcherTeam"), ''), '')) AS pitcher_team_code,
    ''::text AS pitcherhand_norm,
    CASE
      WHEN LOWER(TRIM(COALESCE(pd."BatterSide", ''))) IN ('r','right') THEN 'Right'
      WHEN LOWER(TRIM(COALESCE(pd."BatterSide", ''))) IN ('l','left') THEN 'Left'
      ELSE ''
    END AS batterside_norm,
    CASE
      WHEN LOWER(TRIM(COALESCE(pd."TaggedPitchType", ''))) IN ('fastball','sinker') THEN 'Fastballs'
      WHEN LOWER(TRIM(COALESCE(pd."TaggedPitchType", ''))) IN ('cutter','slider','sweeper','curveball') THEN 'Breaking Balls'
      WHEN LOWER(TRIM(COALESCE(pd."TaggedPitchType", ''))) IN ('changeup','splitter','forkball','screwball') THEN 'Off-Speed'
      ELSE 'Other'
    END AS pitch_group,
    COALESCE(NULLIF(TRIM(pd."TaggedPitchType"), ''), 'Unknown') AS pitch_type,
    CASE
      WHEN GREATEST(0, LEAST(3, COALESCE((NULLIF(BTRIM(pd."Balls"::text), ''))::int, 0))) = 0
       AND GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pd."Strikes"::text), ''))::int, 0))) = 0 THEN '0-0'
      WHEN GREATEST(0, LEAST(3, COALESCE((NULLIF(BTRIM(pd."Balls"::text), ''))::int, 0))) = 1
       AND GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pd."Strikes"::text), ''))::int, 0))) = 1 THEN '1-1'
      WHEN GREATEST(0, LEAST(3, COALESCE((NULLIF(BTRIM(pd."Balls"::text), ''))::int, 0))) > GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pd."Strikes"::text), ''))::int, 0))) THEN 'Behind'
      WHEN GREATEST(0, LEAST(3, COALESCE((NULLIF(BTRIM(pd."Balls"::text), ''))::int, 0))) < GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pd."Strikes"::text), ''))::int, 0))) THEN 'Ahead'
      ELSE 'Even'
    END AS count_bucket,
    CASE
      WHEN REGEXP_REPLACE(LOWER(COALESCE(pd."KorBB", '')), '[^a-z0-9]+', '', 'g') IN ('strikeout','walk','intentwalk','intentionalwalk','strikeoutdoubleplay')
        OR REGEXP_REPLACE(LOWER(COALESCE(pd."PitchCall", '')), '[^a-z0-9]+', '', 'g') IN ('inplayouts','inplaynoout','inplayruns','inplay','hitintoplay','hitbypitch')
      THEN 'PA End'
      WHEN LEAST(3, GREATEST(0, LEAST(3, COALESCE((NULLIF(BTRIM(pd."Balls"::text), ''))::int, 0))) + CASE WHEN REGEXP_REPLACE(LOWER(COALESCE(pd."PitchCall", '')), '[^a-z0-9]+', '', 'g') IN ('ball','ballcalled','ballindirt','ballintentional') THEN 1 ELSE 0 END)
         > LEAST(2, GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pd."Strikes"::text), ''))::int, 0))) + CASE WHEN REGEXP_REPLACE(LOWER(COALESCE(pd."PitchCall", '')), '[^a-z0-9]+', '', 'g') IN ('calledstrike','strikecalled','swingingstrike','swingingstrikeblocked','strikeswinging') OR (REGEXP_REPLACE(LOWER(COALESCE(pd."PitchCall", '')), '[^a-z0-9]+', '', 'g') IN ('foul','foultip','foulball','foulballfieldable','foulballnotfieldable') AND GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pd."Strikes"::text), ''))::int, 0))) < 2) THEN 1 ELSE 0 END)
      THEN 'Behind'
      WHEN LEAST(3, GREATEST(0, LEAST(3, COALESCE((NULLIF(BTRIM(pd."Balls"::text), ''))::int, 0))) + CASE WHEN REGEXP_REPLACE(LOWER(COALESCE(pd."PitchCall", '')), '[^a-z0-9]+', '', 'g') IN ('ball','ballcalled','ballindirt','ballintentional') THEN 1 ELSE 0 END)
         < LEAST(2, GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pd."Strikes"::text), ''))::int, 0))) + CASE WHEN REGEXP_REPLACE(LOWER(COALESCE(pd."PitchCall", '')), '[^a-z0-9]+', '', 'g') IN ('calledstrike','strikecalled','swingingstrike','swingingstrikeblocked','strikeswinging') OR (REGEXP_REPLACE(LOWER(COALESCE(pd."PitchCall", '')), '[^a-z0-9]+', '', 'g') IN ('foul','foultip','foulball','foulballfieldable','foulballnotfieldable') AND GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pd."Strikes"::text), ''))::int, 0))) < 2) THEN 1 ELSE 0 END)
      THEN 'Ahead'
      WHEN LEAST(3, GREATEST(0, LEAST(3, COALESCE((NULLIF(BTRIM(pd."Balls"::text), ''))::int, 0))) + CASE WHEN REGEXP_REPLACE(LOWER(COALESCE(pd."PitchCall", '')), '[^a-z0-9]+', '', 'g') IN ('ball','ballcalled','ballindirt','ballintentional') THEN 1 ELSE 0 END) = 1
       AND LEAST(2, GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pd."Strikes"::text), ''))::int, 0))) + CASE WHEN REGEXP_REPLACE(LOWER(COALESCE(pd."PitchCall", '')), '[^a-z0-9]+', '', 'g') IN ('calledstrike','strikecalled','swingingstrike','swingingstrikeblocked','strikeswinging') OR (REGEXP_REPLACE(LOWER(COALESCE(pd."PitchCall", '')), '[^a-z0-9]+', '', 'g') IN ('foul','foultip','foulball','foulballfieldable','foulballnotfieldable') AND GREATEST(0, LEAST(2, COALESCE((NULLIF(BTRIM(pd."Strikes"::text), ''))::int, 0))) < 2) THEN 1 ELSE 0 END) = 1
      THEN '1-1'
      ELSE 'Even'
    END AS after_count_bucket,
    COALESCE(NULLIF(BTRIM(pd."Inning"::text), ''), 'Unknown') AS inning_bucket,
    GREATEST(0, LEAST(23, FLOOR((((NULLIF(BTRIM(pd."PlateLocSide"::text), '')::double precision) + 2.5) / 5.0) * 24.0)::smallint)) AS plate_x_bin,
    GREATEST(0, LEAST(29, FLOOR((((NULLIF(BTRIM(pd."PlateLocHeight"::text), '')::double precision) - 0.0) / 5.0) * 30.0)::smallint)) AS plate_z_bin,
    NULLIF(TRIM(COALESCE(pd."StuffPlus"::text, '')), '')::double precision AS stuff_plus,
    NULLIF(TRIM(COALESCE(pd."QPPlus"::text, '')), '')::double precision AS qp_plus,
    NULLIF(TRIM(COALESCE(pd."CtrlPlus"::text, '')), '')::double precision AS ctrl_plus,
    NULLIF(TRIM(COALESCE(pd."PitchingPlus"::text, '')), '')::double precision AS pitching_plus
  FROM public.pitch_data pd
  WHERE pd."Date" IS NOT NULL
    AND REGEXP_REPLACE(LOWER(COALESCE(NULLIF(TRIM(pd."TaggedPitchType"), ''), 'undefined')), '[^a-z0-9]', '', 'g') NOT IN ('', 'unknown', 'undefined', 'other', 'untagged', 'na', 'none', 'null')
), plus_agg AS (
  SELECT
    session_date, school_code, pitcher_norm, pitcherhand_norm, batterside_norm,
    pitch_group, pitch_type, count_bucket, after_count_bucket, inning_bucket, plate_x_bin, plate_z_bin,
    SUM(CASE WHEN stuff_plus IS NOT NULL THEN stuff_plus ELSE 0 END)::double precision AS stuff_plus_sum,
    SUM(CASE WHEN stuff_plus IS NOT NULL THEN 1 ELSE 0 END)::int AS stuff_plus_n,
    SUM(CASE WHEN qp_plus IS NOT NULL THEN qp_plus ELSE 0 END)::double precision AS qp_plus_sum,
    SUM(CASE WHEN qp_plus IS NOT NULL THEN 1 ELSE 0 END)::int AS qp_plus_n,
    SUM(CASE WHEN ctrl_plus IS NOT NULL THEN ctrl_plus ELSE 0 END)::double precision AS ctrl_plus_sum,
    SUM(CASE WHEN ctrl_plus IS NOT NULL THEN 1 ELSE 0 END)::int AS ctrl_plus_n,
    SUM(CASE WHEN pitching_plus IS NOT NULL THEN pitching_plus ELSE 0 END)::double precision AS pitching_plus_sum,
    SUM(CASE WHEN pitching_plus IS NOT NULL THEN 1 ELSE 0 END)::int AS pitching_plus_n
  FROM plus_src
  WHERE school_code <> '' AND pitcher_norm <> ''
  GROUP BY 1,2,3,4,5,6,7,8,9,10,11,12
), agg AS (
  SELECT
    session_date, school_code, session_type_bucket, pitcher_norm, pitcher_team_code, pitcherhand_norm, batterside_norm,
    pitch_group, pitch_type, count_bucket, after_count_bucket, inning_bucket,
    GREATEST(0, LEAST(23, plate_x_bin)) AS plate_x_bin,
    GREATEST(0, LEAST(29, plate_z_bin)) AS plate_z_bin,
    COUNT(*)::int AS pitch_n,
    SUM(CASE WHEN REGEXP_REPLACE(LOWER(COALESCE(pitch_call, '')), '[^a-z0-9]+', '', 'g') IN ('swingingstrike','swingingstrikeblocked','strikeswinging','foul','foultip','foulbunt','foulball','foulballfieldable','foulballnotfieldable','inplayouts','inplaynoout','inplayruns','inplay','hitintoplay') THEN 1 ELSE 0 END)::int AS swing_n,
    SUM(CASE WHEN REGEXP_REPLACE(LOWER(COALESCE(pitch_call, '')), '[^a-z0-9]+', '', 'g') IN ('swingingstrike','swingingstrikeblocked','strikeswinging','foultip','missedbunt') THEN 1 ELSE 0 END)::int AS whiff_n,
    SUM(CASE WHEN REGEXP_REPLACE(LOWER(COALESCE(pitch_call, '')), '[^a-z0-9]+', '', 'g') IN ('inplayouts','inplaynoout','inplayruns','inplay','hitintoplay') THEN 1 ELSE 0 END)::int AS in_play_n,
    SUM(CASE WHEN REGEXP_REPLACE(LOWER(COALESCE(tagged_hit_type, '')), '[^a-z0-9]+', '_', 'g') IN ('groundball', 'ground_ball') THEN 1 WHEN launch_angle IS NOT NULL AND launch_angle <= 10 THEN 1 ELSE 0 END)::int AS gb_n,
    SUM(CASE WHEN REGEXP_REPLACE(LOWER(COALESCE(pitch_call, '')), '[^a-z0-9]+', '', 'g') IN ('calledstrike', 'strikecalled') THEN 1 ELSE 0 END)::int AS cs_n,
    SUM(CASE WHEN REGEXP_REPLACE(LOWER(COALESCE(pitch_call, '')), '[^a-z0-9]+', '', 'g') IN ('calledstrike','strikecalled','ball','ballcalled','ballindirt','pitchout','hitbypitch') THEN 1 ELSE 0 END)::int AS take_n,
    SUM(CASE WHEN REGEXP_REPLACE(LOWER(COALESCE(korbb, '')), '[^a-z0-9]+', '', 'g') IN ('strikeout','walk','intentwalk','intentionalwalk','strikeoutdoubleplay')
              OR REGEXP_REPLACE(LOWER(COALESCE(pitch_call, '')), '[^a-z0-9]+', '', 'g') IN ('inplayouts','inplaynoout','inplayruns','inplay','hitintoplay','hitbypitch')
             THEN 1 ELSE 0 END)::int AS pa_n,
    SUM(CASE WHEN plate_x_bin BETWEEN 7 AND 16 AND plate_z_bin BETWEEN 9 AND 21 THEN 1 ELSE 0 END)::int AS inzone_n,
    SUM(CASE WHEN plate_x_bin BETWEEN 4 AND 19 AND plate_z_bin BETWEEN 6 AND 24 THEN 1 ELSE 0 END)::int AS comp_n,
    SUM(CASE WHEN balls_num = 0 AND strikes_num = 0 THEN 1 ELSE 0 END)::int AS fps_den,
    SUM(CASE WHEN balls_num = 0 AND strikes_num = 0 AND REGEXP_REPLACE(LOWER(COALESCE(pitch_call, '')), '[^a-z0-9]+', '', 'g') IN ('calledstrike','strikecalled','swingingstrike','swingingstrikeblocked','strikeswinging','foul','foultip','foulbunt','foulball','foulballfieldable','foulballnotfieldable','inplayouts','inplaynoout','inplayruns','inplay','hitintoplay') THEN 1 ELSE 0 END)::int AS fps_num,
    SUM(CASE WHEN (balls_num + strikes_num) <= 1 THEN 1 ELSE 0 END)::int AS early_den,
    SUM(CASE WHEN (balls_num + strikes_num) <= 1 AND REGEXP_REPLACE(LOWER(COALESCE(pitch_call, '')), '[^a-z0-9]+', '', 'g') IN ('calledstrike','strikecalled','swingingstrike','swingingstrikeblocked','strikeswinging','foul','foultip','foulbunt','foulball','foulballfieldable','foulballnotfieldable','inplayouts','inplaynoout','inplayruns','inplay','hitintoplay') THEN 1 ELSE 0 END)::int AS early_num,
    SUM(CASE WHEN strikes_num > balls_num THEN 1 ELSE 0 END)::int AS ahead_den,
    SUM(CASE WHEN strikes_num > balls_num AND REGEXP_REPLACE(LOWER(COALESCE(pitch_call, '')), '[^a-z0-9]+', '', 'g') IN ('calledstrike','strikecalled','swingingstrike','swingingstrikeblocked','strikeswinging','foul','foultip','foulbunt','foulball','foulballfieldable','foulballnotfieldable','inplayouts','inplaynoout','inplayruns','inplay','hitintoplay') THEN 1 ELSE 0 END)::int AS ahead_num,
    SUM(CASE WHEN ((balls_num + strikes_num) <= 1 OR strikes_num > balls_num) THEN 1 ELSE 0 END)::int AS ea_den,
    SUM(CASE WHEN ((balls_num + strikes_num) <= 1 OR strikes_num > balls_num) AND REGEXP_REPLACE(LOWER(COALESCE(pitch_call, '')), '[^a-z0-9]+', '', 'g') IN ('calledstrike','strikecalled','swingingstrike','swingingstrikeblocked','strikeswinging','foul','foultip','foulbunt','foulball','foulballfieldable','foulballnotfieldable','inplayouts','inplaynoout','inplayruns','inplay','hitintoplay') THEN 1 ELSE 0 END)::int AS ea_num,
    SUM(CASE WHEN balls_num = 1 AND strikes_num = 1 THEN 1 ELSE 0 END)::int AS oneone_den,
    SUM(CASE WHEN balls_num = 1 AND strikes_num = 1 AND REGEXP_REPLACE(LOWER(COALESCE(pitch_call, '')), '[^a-z0-9]+', '', 'g') IN ('calledstrike','strikecalled','swingingstrike','swingingstrikeblocked','strikeswinging','foul','foultip','foulbunt','foulball','foulballfieldable','foulballnotfieldable','inplayouts','inplaynoout','inplayruns','inplay','hitintoplay') THEN 1 ELSE 0 END)::int AS oneone_num,
    SUM(CASE WHEN NOT (plate_x_bin BETWEEN 7 AND 16 AND plate_z_bin BETWEEN 9 AND 21) AND REGEXP_REPLACE(LOWER(COALESCE(pitch_call, '')), '[^a-z0-9]+', '', 'g') IN ('swingingstrike','swingingstrikeblocked','strikeswinging','foul','foultip','foulbunt','foulball','foulballfieldable','foulballnotfieldable','inplayouts','inplaynoout','inplayruns','inplay','hitintoplay') THEN 1 ELSE 0 END)::int AS chase_n,
    SUM(CASE WHEN REGEXP_REPLACE(LOWER(COALESCE(play_result, '')), '[^a-z0-9]+', '', 'g') IN ('single','double','triple','homerun','homer') THEN 1 ELSE 0 END)::int AS h_n,
    SUM(CASE WHEN REGEXP_REPLACE(LOWER(COALESCE(play_result, '')), '[^a-z0-9]+', '', 'g') IN ('double','triple','homerun','homer') THEN 1 ELSE 0 END)::int AS xbh_n,
    SUM(CASE WHEN REGEXP_REPLACE(LOWER(COALESCE(play_result, '')), '[^a-z0-9]+', '', 'g') IN ('homerun','homer') THEN 1 ELSE 0 END)::int AS hr_n,
    SUM(CASE WHEN REGEXP_REPLACE(LOWER(COALESCE(pitch_call, '')), '[^a-z0-9]+', '', 'g') IN ('hitbypitch') OR REGEXP_REPLACE(LOWER(COALESCE(play_result, '')), '[^a-z0-9]+', '', 'g') IN ('hitbypitch') THEN 1 ELSE 0 END)::int AS hbp_n,
    SUM(CASE WHEN balls_num = 0 AND strikes_num = 0 AND LOWER(COALESCE(pitch_group,''))='fastballs' THEN 1 ELSE 0 END)::int AS fps_fb_den,
    SUM(CASE WHEN balls_num = 0 AND strikes_num = 0 AND LOWER(COALESCE(pitch_group,''))='fastballs' AND REGEXP_REPLACE(LOWER(COALESCE(pitch_call, '')), '[^a-z0-9]+', '', 'g') IN ('calledstrike','strikecalled','swingingstrike','swingingstrikeblocked','strikeswinging','foul','foultip','foulbunt','foulball','foulballfieldable','foulballnotfieldable','inplayouts','inplaynoout','inplayruns','inplay','hitintoplay') THEN 1 ELSE 0 END)::int AS fps_fb_num,
    SUM(CASE WHEN balls_num = 0 AND strikes_num = 0 AND LOWER(COALESCE(pitch_group,''))='off-speed' THEN 1 ELSE 0 END)::int AS fps_os_den,
    SUM(CASE WHEN balls_num = 0 AND strikes_num = 0 AND LOWER(COALESCE(pitch_group,''))='off-speed' AND REGEXP_REPLACE(LOWER(COALESCE(pitch_call, '')), '[^a-z0-9]+', '', 'g') IN ('calledstrike','strikecalled','swingingstrike','swingingstrikeblocked','strikeswinging','foul','foultip','foulbunt','foulball','foulballfieldable','foulballnotfieldable','inplayouts','inplaynoout','inplayruns','inplay','hitintoplay') THEN 1 ELSE 0 END)::int AS fps_os_num,
    SUM(CASE WHEN REGEXP_REPLACE(LOWER(COALESCE(tagged_hit_type, '')), '[^a-z0-9]+', '_', 'g') LIKE '%barrel%' THEN 1 ELSE 0 END)::int AS barrel_n,
    SUM(CASE WHEN xiso_n > 0 THEN xiso ELSE 0 END)::double precision AS xiso_sum,
    SUM(xiso_n)::int AS xiso_n,
    SUM(CASE WHEN relspeed IS NOT NULL THEN relspeed ELSE 0 END)::double precision AS relspeed_sum,
    SUM(CASE WHEN relspeed IS NOT NULL THEN 1 ELSE 0 END)::int AS relspeed_n,
    MAX(COALESCE(relspeed, 0.0))::double precision AS relspeed_max,
    SUM(CASE WHEN ivb IS NOT NULL THEN ivb ELSE 0 END)::double precision AS ivb_sum,
    SUM(CASE WHEN ivb IS NOT NULL THEN 1 ELSE 0 END)::int AS ivb_n,
    SUM(CASE WHEN hb IS NOT NULL THEN hb ELSE 0 END)::double precision AS hb_sum,
    SUM(CASE WHEN hb IS NOT NULL THEN 1 ELSE 0 END)::int AS hb_n,
    SUM(CASE WHEN spinrate IS NOT NULL THEN spinrate ELSE 0 END)::double precision AS spin_sum,
    SUM(CASE WHEN spinrate IS NOT NULL THEN 1 ELSE 0 END)::int AS spin_n,
    SUM(CASE WHEN relheight IS NOT NULL THEN relheight ELSE 0 END)::double precision AS relheight_sum,
    SUM(CASE WHEN relheight IS NOT NULL THEN 1 ELSE 0 END)::int AS relheight_n,
    SUM(CASE WHEN relside IS NOT NULL THEN relside ELSE 0 END)::double precision AS relside_sum,
    SUM(CASE WHEN relside IS NOT NULL THEN 1 ELSE 0 END)::int AS relside_n,
    SUM(CASE WHEN ext IS NOT NULL THEN ext ELSE 0 END)::double precision AS extension_sum,
    SUM(CASE WHEN ext IS NOT NULL THEN 1 ELSE 0 END)::int AS extension_n,
    SUM(CASE WHEN releasetilt IS NOT NULL THEN releasetilt ELSE 0 END)::double precision AS releasetilt_sum,
    SUM(CASE WHEN releasetilt IS NOT NULL THEN 1 ELSE 0 END)::int AS releasetilt_n,
    SUM(CASE WHEN REGEXP_REPLACE(LOWER(COALESCE(korbb, '')), '[^a-z0-9]+', '', 'g') IN ('strikeout','strikeoutdoubleplay') THEN 1 ELSE 0 END)::int AS k_n,
    SUM(CASE WHEN REGEXP_REPLACE(LOWER(COALESCE(korbb, '')), '[^a-z0-9]+', '', 'g') IN ('walk','intentwalk','intentionalwalk') THEN 1 ELSE 0 END)::int AS bb_n,
    SUM(rv)::double precision AS rv_sum,
    SUM(pv)::double precision AS pv_sum,
    SUM(xwoba)::double precision AS xwoba_sum,
    SUM(xwoba_n)::int AS xwoba_n,
    SUM(CASE WHEN ev IS NOT NULL THEN ev ELSE 0 END)::double precision AS ev_sum,
    SUM(CASE WHEN ev IS NOT NULL THEN 1 ELSE 0 END)::int AS ev_n
  FROM src
  WHERE school_code <> '' AND pitcher_norm <> '' AND plate_x_bin IS NOT NULL AND plate_z_bin IS NOT NULL
  GROUP BY 1,2,3,4,5,6,7,8,9,10,11,12,13,14
)
INSERT INTO public.pitching_heatmap_daily_bins (
  session_date, school_code, session_type_bucket, pitcher_norm, pitcher_team_code, pitcherhand_norm, batterside_norm,
  pitch_group, pitch_type, count_bucket, after_count_bucket, inning_bucket, plate_x_bin, plate_z_bin,
  pitch_n, swing_n, whiff_n, in_play_n, gb_n, cs_n, take_n, pa_n,
  inzone_n, comp_n, fps_den, fps_num, early_den, early_num, ahead_den, ahead_num, ea_den, ea_num, oneone_den, oneone_num, chase_n,
  h_n, xbh_n, hr_n, hbp_n,
  fps_fb_den, fps_fb_num, fps_os_den, fps_os_num,
  barrel_n, xiso_sum, xiso_n, relspeed_sum, relspeed_n, relspeed_max, ivb_sum, ivb_n, hb_sum, hb_n, spin_sum, spin_n, relheight_sum, relheight_n, relside_sum, relside_n, extension_sum, extension_n, releasetilt_sum, releasetilt_n,
  stuff_plus_sum, stuff_plus_n, qp_plus_sum, qp_plus_n, ctrl_plus_sum, ctrl_plus_n, pitching_plus_sum, pitching_plus_n,
  k_n, bb_n,
  rv_sum, pv_sum, xwoba_sum, xwoba_n, ev_sum, ev_n, updated_at
)
SELECT
  a.session_date, a.school_code, a.session_type_bucket, a.pitcher_norm, a.pitcher_team_code, a.pitcherhand_norm, a.batterside_norm,
  a.pitch_group, a.pitch_type, a.count_bucket, a.after_count_bucket, a.inning_bucket, a.plate_x_bin, a.plate_z_bin,
  a.pitch_n, a.swing_n, a.whiff_n, a.in_play_n, a.gb_n, a.cs_n, a.take_n, a.pa_n,
  a.inzone_n, a.comp_n, a.fps_den, a.fps_num, a.early_den, a.early_num, a.ahead_den, a.ahead_num, a.ea_den, a.ea_num, a.oneone_den, a.oneone_num, a.chase_n,
  a.h_n, a.xbh_n, a.hr_n, a.hbp_n,
  a.fps_fb_den, a.fps_fb_num, a.fps_os_den, a.fps_os_num,
  a.barrel_n, a.xiso_sum, a.xiso_n, a.relspeed_sum, a.relspeed_n, a.relspeed_max, a.ivb_sum, a.ivb_n, a.hb_sum, a.hb_n, a.spin_sum, a.spin_n, a.relheight_sum, a.relheight_n, a.relside_sum, a.relside_n, a.extension_sum, a.extension_n, a.releasetilt_sum, a.releasetilt_n,
  COALESCE(p.stuff_plus_sum, 0), COALESCE(p.stuff_plus_n, 0), COALESCE(p.qp_plus_sum, 0), COALESCE(p.qp_plus_n, 0), COALESCE(p.ctrl_plus_sum, 0), COALESCE(p.ctrl_plus_n, 0), COALESCE(p.pitching_plus_sum, 0), COALESCE(p.pitching_plus_n, 0),
  a.k_n, a.bb_n,
  a.rv_sum, a.pv_sum, a.xwoba_sum, a.xwoba_n, a.ev_sum, a.ev_n, NOW()
FROM agg a
LEFT JOIN plus_agg p
  ON p.session_date = a.session_date
 AND p.school_code = a.school_code
 AND p.pitcher_norm = a.pitcher_norm
 AND p.pitcherhand_norm = a.pitcherhand_norm
 AND p.batterside_norm = a.batterside_norm
 AND p.pitch_group = a.pitch_group
 AND p.pitch_type = a.pitch_type
 AND p.count_bucket = a.count_bucket
 AND p.after_count_bucket = a.after_count_bucket
 AND p.inning_bucket = a.inning_bucket
 AND p.plate_x_bin = a.plate_x_bin
 AND p.plate_z_bin = a.plate_z_bin
ON CONFLICT (
  session_date, school_code, session_type_bucket, pitcher_norm, pitcher_team_code, pitcherhand_norm, batterside_norm,
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
  comp_n = EXCLUDED.comp_n,
  fps_den = EXCLUDED.fps_den,
  fps_num = EXCLUDED.fps_num,
  early_den = EXCLUDED.early_den,
  early_num = EXCLUDED.early_num,
  ahead_den = EXCLUDED.ahead_den,
  ahead_num = EXCLUDED.ahead_num,
  ea_den = EXCLUDED.ea_den,
  ea_num = EXCLUDED.ea_num,
  oneone_den = EXCLUDED.oneone_den,
  oneone_num = EXCLUDED.oneone_num,
  chase_n = EXCLUDED.chase_n,
  h_n = EXCLUDED.h_n,
  xbh_n = EXCLUDED.xbh_n,
  hr_n = EXCLUDED.hr_n,
  hbp_n = EXCLUDED.hbp_n,
  fps_fb_den = EXCLUDED.fps_fb_den,
  fps_fb_num = EXCLUDED.fps_fb_num,
  fps_os_den = EXCLUDED.fps_os_den,
  fps_os_num = EXCLUDED.fps_os_num,
  barrel_n = EXCLUDED.barrel_n,
  xiso_sum = EXCLUDED.xiso_sum,
  xiso_n = EXCLUDED.xiso_n,
  relspeed_sum = EXCLUDED.relspeed_sum,
  relspeed_n = EXCLUDED.relspeed_n,
  relspeed_max = EXCLUDED.relspeed_max,
  ivb_sum = EXCLUDED.ivb_sum,
  ivb_n = EXCLUDED.ivb_n,
  hb_sum = EXCLUDED.hb_sum,
  hb_n = EXCLUDED.hb_n,
  spin_sum = EXCLUDED.spin_sum,
  spin_n = EXCLUDED.spin_n,
  relheight_sum = EXCLUDED.relheight_sum,
  relheight_n = EXCLUDED.relheight_n,
  relside_sum = EXCLUDED.relside_sum,
  relside_n = EXCLUDED.relside_n,
  extension_sum = EXCLUDED.extension_sum,
  extension_n = EXCLUDED.extension_n,
  releasetilt_sum = EXCLUDED.releasetilt_sum,
  releasetilt_n = EXCLUDED.releasetilt_n,
  stuff_plus_sum = EXCLUDED.stuff_plus_sum,
  stuff_plus_n = EXCLUDED.stuff_plus_n,
  qp_plus_sum = EXCLUDED.qp_plus_sum,
  qp_plus_n = EXCLUDED.qp_plus_n,
  ctrl_plus_sum = EXCLUDED.ctrl_plus_sum,
  ctrl_plus_n = EXCLUDED.ctrl_plus_n,
  pitching_plus_sum = EXCLUDED.pitching_plus_sum,
  pitching_plus_n = EXCLUDED.pitching_plus_n,
  k_n = EXCLUDED.k_n,
  bb_n = EXCLUDED.bb_n,
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
            with open('scripts/create_pitching_heatmap_rollup.sql', 'r', encoding='utf-8') as f:
                cur.execute(f.read())
            cur.execute(SQL)
        conn.commit()
    print('ok: refreshed pitching_heatmap_daily_bins')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
