BEGIN;

CREATE TABLE IF NOT EXISTS public.pro_hitting_heatmap_daily_bins (
  session_date date NOT NULL,
  level_bucket text NOT NULL,
  batter_norm text NOT NULL,
  batter_team_code text NOT NULL,
  pitcherthrows_norm text NOT NULL,
  pitch_group text NOT NULL,
  pitch_type text NOT NULL,
  count_bucket text NOT NULL DEFAULT 'All',
  after_count_bucket text NOT NULL DEFAULT 'All',
  inning_bucket text NOT NULL DEFAULT 'All',
  plate_x_bin smallint NOT NULL,
  plate_z_bin smallint NOT NULL,
  pitch_n integer NOT NULL DEFAULT 0,
  swing_n integer NOT NULL DEFAULT 0,
  whiff_n integer NOT NULL DEFAULT 0,
  in_play_n integer NOT NULL DEFAULT 0,
  gb_n integer NOT NULL DEFAULT 0,
  cs_n integer NOT NULL DEFAULT 0,
  take_n integer NOT NULL DEFAULT 0,
  pa_n integer NOT NULL DEFAULT 0,
  inzone_n integer NOT NULL DEFAULT 0,
  fps_den integer NOT NULL DEFAULT 0,
  fps_num integer NOT NULL DEFAULT 0,
  fps_fb_den integer NOT NULL DEFAULT 0,
  fps_fb_num integer NOT NULL DEFAULT 0,
  fps_os_den integer NOT NULL DEFAULT 0,
  fps_os_num integer NOT NULL DEFAULT 0,
  chase_n integer NOT NULL DEFAULT 0,
  h_n integer NOT NULL DEFAULT 0,
  xbh_n integer NOT NULL DEFAULT 0,
  hr_n integer NOT NULL DEFAULT 0,
  hbp_n integer NOT NULL DEFAULT 0,
  k_n integer NOT NULL DEFAULT 0,
  bb_n integer NOT NULL DEFAULT 0,
  barrel_n integer NOT NULL DEFAULT 0,
  xiso_sum double precision NOT NULL DEFAULT 0,
  xiso_n integer NOT NULL DEFAULT 0,
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
    count_bucket,
    after_count_bucket,
    inning_bucket,
    plate_x_bin,
    plate_z_bin
  )
);

CREATE INDEX IF NOT EXISTS idx_pro_hhm_date_level_team_hand
  ON public.pro_hitting_heatmap_daily_bins (session_date, level_bucket, batter_team_code, pitcherthrows_norm);

CREATE INDEX IF NOT EXISTS idx_pro_hhm_date_batter
  ON public.pro_hitting_heatmap_daily_bins (session_date, batter_norm);

-- Hitter-scoped reports filter on batter first and then a date range. Keeping
-- batter_norm first avoids scanning every hitter represented in the date span.
CREATE INDEX IF NOT EXISTS idx_pro_hhm_batter_date
  ON public.pro_hitting_heatmap_daily_bins (batter_norm, session_date);

ALTER TABLE public.pro_hitting_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS pa_n integer NOT NULL DEFAULT 0;
ALTER TABLE public.pro_hitting_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS inzone_n integer NOT NULL DEFAULT 0;
ALTER TABLE public.pro_hitting_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS fps_den integer NOT NULL DEFAULT 0;
ALTER TABLE public.pro_hitting_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS fps_num integer NOT NULL DEFAULT 0;
ALTER TABLE public.pro_hitting_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS fps_fb_den integer NOT NULL DEFAULT 0;
ALTER TABLE public.pro_hitting_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS fps_fb_num integer NOT NULL DEFAULT 0;
ALTER TABLE public.pro_hitting_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS fps_os_den integer NOT NULL DEFAULT 0;
ALTER TABLE public.pro_hitting_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS fps_os_num integer NOT NULL DEFAULT 0;
ALTER TABLE public.pro_hitting_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS chase_n integer NOT NULL DEFAULT 0;
ALTER TABLE public.pro_hitting_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS h_n integer NOT NULL DEFAULT 0;
ALTER TABLE public.pro_hitting_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS xbh_n integer NOT NULL DEFAULT 0;
ALTER TABLE public.pro_hitting_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS hr_n integer NOT NULL DEFAULT 0;
ALTER TABLE public.pro_hitting_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS hbp_n integer NOT NULL DEFAULT 0;
ALTER TABLE public.pro_hitting_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS k_n integer NOT NULL DEFAULT 0;
ALTER TABLE public.pro_hitting_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS bb_n integer NOT NULL DEFAULT 0;
ALTER TABLE public.pro_hitting_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS barrel_n integer NOT NULL DEFAULT 0;
ALTER TABLE public.pro_hitting_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS xiso_sum double precision NOT NULL DEFAULT 0;
ALTER TABLE public.pro_hitting_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS xiso_n integer NOT NULL DEFAULT 0;
ALTER TABLE public.pro_hitting_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS count_bucket text NOT NULL DEFAULT 'All';
ALTER TABLE public.pro_hitting_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS after_count_bucket text NOT NULL DEFAULT 'All';
ALTER TABLE public.pro_hitting_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS inning_bucket text NOT NULL DEFAULT 'All';
ALTER TABLE public.pro_hitting_heatmap_daily_bins
  DROP CONSTRAINT IF EXISTS pro_hitting_heatmap_daily_bins_pkey;
ALTER TABLE public.pro_hitting_heatmap_daily_bins
  ADD CONSTRAINT pro_hitting_heatmap_daily_bins_pkey PRIMARY KEY (
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
    plate_x_bin,
    plate_z_bin
  );

COMMIT;
