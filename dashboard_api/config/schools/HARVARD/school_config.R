# School-specific overrides for the shared app.
# Copy this file to another repo and keep the same structure when you need to customize colors, logos, APIs, etc.
school_config <- list(
  team_code = "Harvard",
  # Additional school-code markers used in TrackMan team columns (optional).
  # These are checked alongside team_code during allowed-player verification.
  team_code_markers = c("HAR_CRI", "Harvard"),
  allowed_pitchers = c(
  "Abler, Andrew",
  "Alagheband, Luca",
  "Burns, Will",
  "Bergsma, Charley",
  "Colasante, Gio",
  "Dowling, Brian",
  "Gable, Brett",
  "Kahn, Davis",
  "McHugh, Ryan",
  "Sams, Daniel",
  "Sharma, Vedant",
  "Smith, Jack",
  "Tahnk, Owen"
  ),
  allowed_hitters = c(
  ),
  allowed_campers = c(
    "Bowman, Brock",
    "Daniels, Tyke",
    "Pearson, Blake",
    "Rodriguez, Josiah",
    "James, Brody",
    "Nevarez, Matthew",
    "Nunes, Nolan",
    "Parks, Jaeden",
    "Hill, Grant",
    "McGinnis, Ayden",
    "Morton, Ryker",
    "McGuire, John",
    "Willson, Brandon",
    "Lauterbach, Camden",
    "Turnquist, Dylan",
    "Bournonville, Tanner",
    "Evans, Lincoln",
    "Gnirk, Will",
    "Mann, Tyson",
    "Neneman, Chase",
    "Warmus, Joaquin",
    "Kapadia, Taylor",
    "Stoner, Timothy",
    "Bergloff, Cameron",
    "Hamm, Jacob",
    "Hofmeister, Ben",
    "Moo, Eriksen",
    "Peltz, Zayden",
    "Huff, Tyler",
    "Moseman, Cody"
  ),
  colors = list(
    primary             = "#b8112d",   # Harvard crimson from logo
    accent              = "#b8112d",   # use crimson as starting gradient color
    accent_secondary    = "#7f101a",   # darker crimson stop for better contrast
    background          = "#ffffff",   # clean white base matching logo field
    background_secondary= "#f0f0f0"    # light grey from logo shading

  ),
  logo = "Harvardlogo.png",
  coaches_emails = c(
    "nathancole@fas.harvard.edu",
    "jeffrey_kane@fas.harvard.edu",
    "mslattery@fas.harvard.edu",
    "flanagan.kyle15@gmail.com"
  ),
  notes_api = list(
    base_url = "https://script.google.com/macros/s/AKfycbyXJWWRgPib1sSgMtuYCjRW6Wa7UCiC2ojABZHbXSkrhQGogOOYNSMWp4vpNwRYJDdqZg/exec",
    token = "Harvardbaseball"
  ),
  extra = list(
    school_name = "Harvard",
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
