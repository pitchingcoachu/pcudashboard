BEGIN;

CREATE TABLE IF NOT EXISTS public.pitching_heatmap_daily_bins (
  session_date date NOT NULL,
  school_code text NOT NULL,
  session_type_bucket text NOT NULL DEFAULT '',
  pitcher_norm text NOT NULL,
  pitcher_team_code text NOT NULL DEFAULT '',
  pitcherhand_norm text NOT NULL DEFAULT '',
  batterside_norm text NOT NULL DEFAULT '',
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
  comp_n integer NOT NULL DEFAULT 0,
  fps_den integer NOT NULL DEFAULT 0,
  fps_num integer NOT NULL DEFAULT 0,
  early_den integer NOT NULL DEFAULT 0,
  early_num integer NOT NULL DEFAULT 0,
  ahead_den integer NOT NULL DEFAULT 0,
  ahead_num integer NOT NULL DEFAULT 0,
  ea_den integer NOT NULL DEFAULT 0,
  ea_num integer NOT NULL DEFAULT 0,
  oneone_den integer NOT NULL DEFAULT 0,
  oneone_num integer NOT NULL DEFAULT 0,
  chase_n integer NOT NULL DEFAULT 0,
  h_n integer NOT NULL DEFAULT 0,
  xbh_n integer NOT NULL DEFAULT 0,
  hr_n integer NOT NULL DEFAULT 0,
  hbp_n integer NOT NULL DEFAULT 0,
  fps_fb_den integer NOT NULL DEFAULT 0,
  fps_fb_num integer NOT NULL DEFAULT 0,
  fps_os_den integer NOT NULL DEFAULT 0,
  fps_os_num integer NOT NULL DEFAULT 0,
  barrel_n integer NOT NULL DEFAULT 0,
  xiso_sum double precision NOT NULL DEFAULT 0,
  xiso_n integer NOT NULL DEFAULT 0,
  relspeed_sum double precision NOT NULL DEFAULT 0,
  relspeed_n integer NOT NULL DEFAULT 0,
  relspeed_max double precision NOT NULL DEFAULT 0,
  ivb_sum double precision NOT NULL DEFAULT 0,
  ivb_n integer NOT NULL DEFAULT 0,
  hb_sum double precision NOT NULL DEFAULT 0,
  hb_n integer NOT NULL DEFAULT 0,
  spin_sum double precision NOT NULL DEFAULT 0,
  spin_n integer NOT NULL DEFAULT 0,
  relheight_sum double precision NOT NULL DEFAULT 0,
  relheight_n integer NOT NULL DEFAULT 0,
  relside_sum double precision NOT NULL DEFAULT 0,
  relside_n integer NOT NULL DEFAULT 0,
  extension_sum double precision NOT NULL DEFAULT 0,
  extension_n integer NOT NULL DEFAULT 0,
  releasetilt_sum double precision NOT NULL DEFAULT 0,
  releasetilt_n integer NOT NULL DEFAULT 0,
  stuff_plus_sum double precision NOT NULL DEFAULT 0,
  stuff_plus_n integer NOT NULL DEFAULT 0,
  qp_plus_sum double precision NOT NULL DEFAULT 0,
  qp_plus_n integer NOT NULL DEFAULT 0,
  ctrl_plus_sum double precision NOT NULL DEFAULT 0,
  ctrl_plus_n integer NOT NULL DEFAULT 0,
  pitching_plus_sum double precision NOT NULL DEFAULT 0,
  pitching_plus_n integer NOT NULL DEFAULT 0,
  k_n integer NOT NULL DEFAULT 0,
  bb_n integer NOT NULL DEFAULT 0,
  rv_sum double precision NOT NULL,
  pv_sum double precision NOT NULL,
  xwoba_sum double precision NOT NULL,
  xwoba_n integer NOT NULL,
  ev_sum double precision NOT NULL,
  ev_n integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pitching_heatmap_daily_bins_pkey PRIMARY KEY (
    session_date,
    school_code,
    session_type_bucket,
    pitcher_norm,
    pitcher_team_code,
    pitcherhand_norm,
    batterside_norm,
    pitch_group,
    pitch_type,
    count_bucket,
    after_count_bucket,
    inning_bucket,
    plate_x_bin,
    plate_z_bin
  )
);

CREATE INDEX IF NOT EXISTS idx_pitching_heatmap_daily_bins_lookup
  ON public.pitching_heatmap_daily_bins (school_code, session_date, session_type_bucket, pitcher_team_code, pitcherhand_norm, batterside_norm);

CREATE INDEX IF NOT EXISTS idx_pitching_heatmap_daily_bins_pitcher
  ON public.pitching_heatmap_daily_bins (school_code, pitcher_norm, session_date);

ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS k_n integer NOT NULL DEFAULT 0;

ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS bb_n integer NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS pitcherhand_norm text NOT NULL DEFAULT '';
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS count_bucket text NOT NULL DEFAULT 'All';
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS after_count_bucket text NOT NULL DEFAULT 'All';
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS inning_bucket text NOT NULL DEFAULT 'All';
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS pa_n integer NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS inzone_n integer NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS comp_n integer NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS fps_den integer NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS fps_num integer NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS early_den integer NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS early_num integer NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS ahead_den integer NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS ahead_num integer NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS ea_den integer NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS ea_num integer NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS oneone_den integer NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS oneone_num integer NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS chase_n integer NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS h_n integer NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS xbh_n integer NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS hr_n integer NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS hbp_n integer NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS fps_fb_den integer NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS fps_fb_num integer NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS fps_os_den integer NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS fps_os_num integer NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS barrel_n integer NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS xiso_sum double precision NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS xiso_n integer NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS relspeed_sum double precision NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS relspeed_n integer NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS relspeed_max double precision NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS ivb_sum double precision NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS ivb_n integer NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS hb_sum double precision NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS hb_n integer NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS spin_sum double precision NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS spin_n integer NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS relheight_sum double precision NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS relheight_n integer NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS relside_sum double precision NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS relside_n integer NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS extension_sum double precision NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS extension_n integer NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS releasetilt_sum double precision NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS releasetilt_n integer NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS stuff_plus_sum double precision NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS stuff_plus_n integer NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS qp_plus_sum double precision NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS qp_plus_n integer NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS ctrl_plus_sum double precision NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS ctrl_plus_n integer NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS pitching_plus_sum double precision NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD COLUMN IF NOT EXISTS pitching_plus_n integer NOT NULL DEFAULT 0;
ALTER TABLE public.pitching_heatmap_daily_bins
  DROP CONSTRAINT IF EXISTS pitching_heatmap_daily_bins_pkey;
ALTER TABLE public.pitching_heatmap_daily_bins
  ADD CONSTRAINT pitching_heatmap_daily_bins_pkey PRIMARY KEY (
    session_date,
    school_code,
    session_type_bucket,
    pitcher_norm,
    pitcher_team_code,
    pitcherhand_norm,
    batterside_norm,
    pitch_group,
    pitch_type,
    count_bucket,
    after_count_bucket,
    inning_bucket,
    plate_x_bin,
    plate_z_bin
  );

COMMIT;
