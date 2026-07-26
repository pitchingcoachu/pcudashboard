# School-specific overrides for the Dashboard Trial demo school.
school_config <- list(
  team_code = "TRIAL",
  team_code_markers = c("TRIAL", "Dashboard Trial"),
  allowed_pitchers = c(),
  allowed_hitters = c(),
  allowed_campers = c(),
  colors = list(
    primary             = "#c8102e",
    accent              = "#c8102e",
    accent_secondary    = "#8f0f24",
    background          = "#ffffff",
    background_secondary= "#f7f7f8"
  ),
  logo = "pearl-clam-transparent.png",
  coaches_emails = c(),
  notes_api = list(
    base_url = "",
    token = ""
  ),
  extra = list(
    school_name = "Dashboard Trial",
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
