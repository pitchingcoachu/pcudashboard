# Gunderson Baseball dashboard configuration.
# Rosters remain data-driven until Gunderson supplies its initial roster and
# TrackMan FTP connection.
school_config <- list(
  team_code = "GUND",
  team_code_markers = c("GUND", "GUNDERSON", "GUNDERSON BASEBALL"),
  allowed_pitchers = c(),
  allowed_hitters = c(),
  allowed_campers = c(),
  colors = list(
    primary              = "#5F6065",
    accent               = "#F15A24",
    accent_secondary     = "#5F6065",
    background           = "#FFFFFF",
    background_secondary = "#F2F2F3"
  ),
  logo = "gunderson-logo.png",
  coaches_emails = c(),
  notes_api = list(
    base_url = "",
    token = "gundersonbaseball"
  ),
  extra = list(
    school_name = "Gunderson Baseball",
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
