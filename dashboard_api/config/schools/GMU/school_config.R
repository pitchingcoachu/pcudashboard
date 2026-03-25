# School-specific overrides for the shared app.
# Copy this file to another repo and keep the same structure when you need to customize colors, logos, APIs, etc.
school_config <- list(
  team_code = "GMU",
  # Additional school-code markers used in TrackMan team columns (optional).
  # These are checked alongside team_code during allowed-player verification.
  team_code_markers = c("GEO_PAT", "GMU"),
  allowed_pitchers = c(
    "Blanchard, Evan",
    "Butler, Jake",
    "Bagnerise, Julius",
    "Morse, Jackson",
    "Cowdrey, Vincent",
    "Canody, Drew",
    "Terilli, Luciano",
    "Clyne, Owen",
    "Vaughan, Logan",
    "Westley, Matthew",
    "Smith, Cooper",
    "Alberti, Lucas",
    "McCarthy, Jack",
    "Hsu, Brandon",
    "Stewart, Owen",
    "Ertel, Brant",
    "Tignor, Laken",
    "Willis, Tyson",
    "Hueber, Toby",
    "Peters, Jackson",
    "Rumberg, Logan",
    "Wrehe, Thomas",
    "Kaler, Tanner",
    "Parker, Aiden",
    "Thomas, Parker",
    "DiLella, Sam",
    "Drumm, Jake",
    "O'Hara, Austin",
    "Cardenas, Diego",
    "Kelsey, Carter",
    "Okeeffe, Shaun",
    "Madigan, Michael"
  ),
  allowed_hitters = c(
    "Blanchard, Evan",
    "Butler, Jake",
    "Bagnerise, Julius",
    "Morse, Jackson",
    "Cowdrey, Vincent",
    "Canody, Drew",
    "Terilli, Luciano",
    "Clyne, Owen",
    "Vaughan, Logan",
    "Westley, Matthew",
    "Smith, Cooper",
    "Alberti, Lucas",
    "McCarthy, Jack",
    "Hsu, Brandon",
    "Stewart, Owen",
    "Ertel, Brant",
    "Tignor, Laken",
    "Willis, Tyson",
    "Hueber, Toby",
    "Peters, Jackson",
    "Rumberg, Logan",
    "Wrehe, Thomas",
    "Kaler, Tanner",
    "Parker, Aiden",
    "Thomas, Parker",
    "DiLella, Sam",
    "Drumm, Jake",
    "O'Hara, Austin",
    "Cardenas, Diego",
    "Kelsey, Carter",
    "Okeeffe, Shaun",
    "Madigan, Michael"
  ),
  allowed_campers = c(
  ),
  colors = list(
    primary             = "#105135",
    accent              = "#105135",
    accent_secondary    = "#ecb010",
    background          = "#ffffff",
    background_secondary= "#ececec"
  ),
  logo = "GMUlogo.png",
  coaches_emails = c(
    "twinter7@gmu.edu",
    "Tnelin@gmu.edu",
    "Eduhon@gmu.edu",
    "Kdarmst@gmu.edu",
    "scamp4@gmu.edu"
  ),
  notes_api = list(
    base_url = "https://script.google.com/macros/s/AKfycbyVCAS3-BOHGBOaoGxI2Ehwt65l4_TfdS7fAJebXOYZ2mwSPvLiRUXKbljhvhzaFByI/exec",
    token = "gmubaseball"
  ),
  extra = list(
    school_name = "GMU",
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
