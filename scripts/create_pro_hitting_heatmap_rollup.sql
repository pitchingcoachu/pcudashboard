BEGIN;

CREATE TABLE IF NOT EXISTS public.pro_hitting_heatmap_daily_bins (
  session_date date NOT NULL,
  level_bucket text NOT NULL,
  batter_norm text NOT NULL,
  batter_team_code text NOT NULL,
  pitcherthrows_norm text NOT NULL,
  pitch_group text NOT NULL,
  pitch_type text NOT NULL,
  plate_x_bin smallint NOT NULL,
  plate_z_bin smallint NOT NULL,
  pitch_n integer NOT NULL DEFAULT 0,
  swing_n integer NOT NULL DEFAULT 0,
  whiff_n integer NOT NULL DEFAULT 0,
  in_play_n integer NOT NULL DEFAULT 0,
  gb_n integer NOT NULL DEFAULT 0,
  cs_n integer NOT NULL DEFAULT 0,
  take_n integer NOT NULL DEFAULT 0,
  rv_sum double precision NOT NULL DEFAULT 0,
  pv_sum double precision NOT NULL DEFAULT 0,
  xwoba_sum double precision NOT NULL DEFAULT 0,
  xwoba_n integer NOT NULL DEFAULT 0,
  ev_sum double precision NOT NULL DEFAULT 0,
  ev_n integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (
    session_date,
    level_bucket,
    batter_norm,
    batter_team_code,
    pitcherthrows_norm,
    pitch_group,
    pitch_type,
    plate_x_bin,
    plate_z_bin
  )
);

CREATE INDEX IF NOT EXISTS idx_pro_hhm_date_level_team_hand
  ON public.pro_hitting_heatmap_daily_bins (session_date, level_bucket, batter_team_code, pitcherthrows_norm);

CREATE INDEX IF NOT EXISTS idx_pro_hhm_date_batter
  ON public.pro_hitting_heatmap_daily_bins (session_date, batter_norm);

COMMIT;
