# Long Island Ducks dashboard configuration.
# The roster is data-driven: every player appearing for team code LI is a Duck.
school_config <- list(
  team_code = "LI",
  team_code_markers = c("LI"),

  allowed_pitchers = c(),
  allowed_hitters = c(),
  allowed_campers = c(),

  colors = list(
    primary = "#F47A38",
    accent = "#F47A38",
    accent_secondary = "#007348",
    background = "#07120E",
    background_secondary = "#10251C"
  ),
  logo = "long-island-ducks-logo.png",
  display = list(
    school_name = "Long Island Ducks",
    team_label = "Ducks"
  )
)
