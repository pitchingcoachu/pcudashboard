# PRO school scaffold (MLB/AAA adapter source).
# Uses PCU visual defaults initially; roster lists intentionally empty.
school_config <- list(
  team_code = "PRO",
  team_code_markers = c("PRO"),

  # Intentionally empty for pro source; player lists come from MLB API sync.
  allowed_pitchers = c(),
  allowed_hitters = c(),
  allowed_campers = c(),

  colors = list(
    primary = "#c8102e",
    accent = "#c8102e",
    accent_secondary = "#8f0f24",
    background = "#0a0a0a",
    background_secondary = "#151515"
  ),
  logo = "PCUlogo.png",
  display = list(
    school_name = "PRO",
    team_label = "PRO"
  )
)
