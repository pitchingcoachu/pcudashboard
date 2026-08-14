# Lake Erie College dashboard configuration.
# Roster vectors intentionally begin empty so uploaded TrackMan/Rapsodo players
# remain visible until Lake Erie College supplies an official roster.
school_config <- list(
  team_code = "LEC",
  team_code_markers = c("LEC", "LAKE ERIE", "LAKEERIE"),
  allowed_pitchers = c(),
  allowed_hitters = c(),
  allowed_campers = c(),
  colors = list(
    primary              = "#004F3D",
    accent               = "#004F3D",
    accent_secondary     = "#000000",
    background           = "#FFFFFF",
    background_secondary = "#EEF3F1"
  ),
  logo = "lec-logo.png",
  coaches_emails = c(),
  notes_api = list(
    base_url = "",
    token = "lecbaseball"
  ),
  extra = list(
    school_name = "Lake Erie College",
    ftp_folder = "trackman",
    cloudinary_folder = "trackman"
  )
)

colorize_css <- function(css, accent, accent_secondary, background, background_secondary) {
  accent_rgb <- paste(grDevices::col2rgb(accent), collapse = ",")
  accent_secondary_rgb <- paste(grDevices::col2rgb(accent_secondary), collapse = ",")
  css <- gsub("#e35205", accent, css, fixed = TRUE)
  css <- gsub("#ff8c1a", accent_secondary, css, fixed = TRUE)
  css <- gsub("rgba(227,82,5", paste0("rgba(", accent_rgb), css, fixed = TRUE)
  css <- gsub("rgba(227, 82, 5", paste0("rgba(", accent_rgb), css, fixed = TRUE)
  css <- gsub("rgba(255,140,26", paste0("rgba(", accent_secondary_rgb), css, fixed = TRUE)
  css <- gsub("rgba(255, 140, 26", paste0("rgba(", accent_secondary_rgb), css, fixed = TRUE)
  css <- gsub("#f5f7fa", background, css, fixed = TRUE)
  css <- gsub("#e8ecf1", background_secondary, css, fixed = TRUE)
  css
}
