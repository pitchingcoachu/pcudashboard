# School-specific overrides for the shared app.
# Copy this file to another repo and keep the same structure when you need to customize colors, logos, APIs, etc.
school_config <- list(
  team_code = "SEMO",
  # Additional school-code markers used in TrackMan team columns (optional).
  # These are checked alongside team_code during allowed-player verification.
  team_code_markers = c("SOU_RED", "SEMO"),
  # Roster source: SEMO 2026-2027 Baseball Roster (updated 2026-09-16).
  allowed_pitchers = c(
    "Bogart, Evan",
    "Briscoe, Brayden",
    "Carroll, Andrew",
    "Coleman, Blake",
    "Earwood, Ty",
    "Galvin, Colin",
    "Haberkorn, John",
    "Joggerst, Jaxson",
    "Keldsen, JoJo",
    "Lackey, Ben",
    "Lora, Alex",
    "Maynor, Eli",
    "Menth, Alex",
    "O’Neil, Trey",
    "Parsons, Drew",
    "Sauer, John Paul",
    "Scott, Cole",
    "Snider, Ben",
    "Tedder, Rex",
    "Wnukowski, Matt",
    "York, Sean",
    "Zemaitis, Drew"
  ),
  allowed_hitters = c(
    "Andrews, Ty",
    "Callahan, Cooper",
    "Champion, Caleb",
    "Garcia, Andrew",
    "Hall, Joe",
    "Henning, Matthew",
    "Joggerst, Dakota",
    "Kettering, Brooks",
    "Nazarenus, Hayden",
    "Price, Jake",
    "Seymour, Vasya",
    "Sims, Tank",
    "Sullivan, Cal",
    "Terranova, Joe",
    "Yule, Logan",
    "Zdunich, Turner"
  ),
  allowed_campers = c(
  ),
  colors = list(
    primary             = "#DB1934",   # SEMO logo red for high-impact accents
    accent              = "#030001",   # near-black elements from logo contrast
    accent_secondary    = "#ED1E2E",   # a bit more red instead of mid gray
    background          = "#F0F0F0",   # light gray keeps pages bright without navy
    background_secondary= "#F2D8DA"   # subtle pale red to replace the gray card tone
  ),
  logo = "SEMOlogo.png",
  coaches_emails = c(
    "mkinney@semo.edu",
    "tezell@semo.edu",
    "asawyers@semo.edu",
    "cjresetich@semo.edu"
  ),
  notes_api = list(
    base_url = "https://script.google.com/macros/s/AKfycbzdN0gJgRQPxLGrzx9N1m8HDVaF9ukH6iMeVKUbgR6VAMNXS7mhc2URtJZ0ySV0Xfio/exec",
    token = "SEMObaseball"
  ),
  extra = list(
    school_name = "SEMO",
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
