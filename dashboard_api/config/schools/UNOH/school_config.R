# University of Northwestern Ohio dashboard configuration.
# Roster vectors intentionally begin empty so uploaded TrackMan/Rapsodo players
# remain visible until UNOH supplies an official roster.
school_config <- list(
  team_code = "UNOH",
  team_code_markers = c("UNOH"),
  allowed_pitchers = c(),
  allowed_hitters = c(),
  allowed_campers = c(),
  colors = list(
    primary              = "#891F1A",
    accent               = "#000000",
    accent_secondary     = "#A62A24",
    background           = "#FFFFFF",
    background_secondary = "#F4ECEB"
  ),
  logo = "unoh-logo.png",
  coaches_emails = c(),
  notes_api = list(
    base_url = "",
    token = "unohbaseball"
  ),
  extra = list(
    school_name = "University of Northwestern Ohio",
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
