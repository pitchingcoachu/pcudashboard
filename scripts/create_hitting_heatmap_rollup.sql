BEGIN;

CREATE TABLE IF NOT EXISTS public.hitting_heatmap_daily_bins (
  session_date date NOT NULL,
  school_code text NOT NULL,
  session_type_bucket text NOT NULL DEFAULT '',
  batter_norm text NOT NULL,
  batter_team_code text NOT NULL DEFAULT '',
  pitcherthrows_norm text NOT NULL DEFAULT '',
  pitch_group text NOT NULL,
  pitch_type text NOT NULL,
  count_bucket text NOT NULL DEFAULT 'All',
  after_count_bucket text NOT NULL DEFAULT 'All',
  inning_bucket text NOT NULL DEFAULT 'All',
  plate_x_bin smallint NOT NULL,
  plate_z_bin smallint NOT NULL,
  pitch_n integer NOT NULL,
  swing_n integer NOT NULL,
  whiff_n integer NOT NULL,
  in_play_n integer NOT NULL,
  gb_n integer NOT NULL,
  cs_n integer NOT NULL,
  take_n integer NOT NULL,
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
  rv_sum double precision NOT NULL,
  pv_sum double precision NOT NULL,
  xwoba_sum double precision NOT NULL,
  xwoba_n integer NOT NULL,
  ev_sum double precision NOT NULL,
  ev_n integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hitting_heatmap_daily_bins_pkey PRIMARY KEY (
    session_date,
    school_code,
    session_type_bucket,
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

CREATE INDEX IF NOT EXISTS idx_hitting_heatmap_daily_bins_lookup
  ON public.hitting_heatmap_daily_bins (school_code, session_date, session_type_bucket, batter_team_code, pitcherthrows_norm);

CREATE INDEX IF NOT EXISTS idx_hitting_heatmap_daily_bins_batter
  ON public.hitting_heatmap_daily_bins (school_code, batter_norm, session_date);

ALTER TABLE public.hitting_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS pa_n integer NOT NULL DEFAULT 0;
ALTER TABLE public.hitting_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS inzone_n integer NOT NULL DEFAULT 0;
ALTER TABLE public.hitting_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS fps_den integer NOT NULL DEFAULT 0;
ALTER TABLE public.hitting_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS fps_num integer NOT NULL DEFAULT 0;
ALTER TABLE public.hitting_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS fps_fb_den integer NOT NULL DEFAULT 0;
ALTER TABLE public.hitting_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS fps_fb_num integer NOT NULL DEFAULT 0;
ALTER TABLE public.hitting_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS fps_os_den integer NOT NULL DEFAULT 0;
ALTER TABLE public.hitting_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS fps_os_num integer NOT NULL DEFAULT 0;
ALTER TABLE public.hitting_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS chase_n integer NOT NULL DEFAULT 0;
ALTER TABLE public.hitting_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS h_n integer NOT NULL DEFAULT 0;
ALTER TABLE public.hitting_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS xbh_n integer NOT NULL DEFAULT 0;
ALTER TABLE public.hitting_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS hr_n integer NOT NULL DEFAULT 0;
ALTER TABLE public.hitting_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS hbp_n integer NOT NULL DEFAULT 0;
ALTER TABLE public.hitting_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS k_n integer NOT NULL DEFAULT 0;
ALTER TABLE public.hitting_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS bb_n integer NOT NULL DEFAULT 0;
ALTER TABLE public.hitting_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS barrel_n integer NOT NULL DEFAULT 0;
ALTER TABLE public.hitting_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS xiso_sum double precision NOT NULL DEFAULT 0;
ALTER TABLE public.hitting_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS xiso_n integer NOT NULL DEFAULT 0;
ALTER TABLE public.hitting_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS count_bucket text NOT NULL DEFAULT 'All';
ALTER TABLE public.hitting_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS after_count_bucket text NOT NULL DEFAULT 'All';
ALTER TABLE public.hitting_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS inning_bucket text NOT NULL DEFAULT 'All';
ALTER TABLE public.hitting_heatmap_daily_bins
  DROP CONSTRAINT IF EXISTS hitting_heatmap_daily_bins_pkey;
ALTER TABLE public.hitting_heatmap_daily_bins
  ADD CONSTRAINT hitting_heatmap_daily_bins_pkey PRIMARY KEY (
    session_date,
    school_code,
    session_type_bucket,
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
