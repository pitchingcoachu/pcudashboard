# Atlantic League aggregate dashboard configuration.
# Exhibition aliases are intentionally omitted from the approved marker set.
school_config <- list(
  team_code = "INDY",
  team_code_markers = c(
    "LI", "HAG_FLY", "YOR", "LAN", "WES_POW",
    "GAS", "STA_YAN", "LEX_LEG", "HP", "SMD"
  ),

  allowed_pitchers = c(),
  allowed_hitters = c(),
  allowed_campers = c(),

  colors = list(
    primary = "#C4002F",
    accent = "#C4002F",
    accent_secondary = "#062660",
    background = "#050A15",
    background_secondary = "#0B1730"
  ),
  logo = "atlantic-league-logo.webp",
  display = list(
    school_name = "INDY",
    team_label = "Atlantic League"
  )
)

