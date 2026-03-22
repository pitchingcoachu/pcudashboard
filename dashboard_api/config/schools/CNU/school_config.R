# School-specific overrides for the shared app.
# Copy this file to another repo and keep the same structure when you need to customize colors, logos, APIs, etc.
school_config <- list(
  team_code = "CNU",
  # Additional school-code markers used in TrackMan team columns (optional).
  # These are checked alongside team_code during allowed-player verification.
  team_code_markers = c("CAR_EAG", "CNU"),
  # Player filters
  allowed_pitchers = c(
    "Adams, Kyle",
    "Alexander, Trace",
    "Angel, Bransen",
    "Benner, Seth",
    "Bishop, Matthew",
    "Bobo, Aaron",
    "Bolton, Ryan",
    "Butler, Cameron",
    "Carruthers, Wade",
    "Casson, Kolton",
    "Cochran, Carson",
    "Copley, Tyson",
    "Croy, Isaac",
    "Culpepper, Brock",
    "Dobson, Devin",
    "Evans, Colton",
    "Fields, Boone",
    "Fletcher, Drew",
    "Floyd, Logan",
    "Gibson, Aiden",
    "Greene, Maddox",
    "Griner, Gavin",
    "Hall, Cameron",
    "Hammond, Kevin",
    "Henderson, Christian",
    "Higgins, Ryan",
    "Hoffman, Wyatt",
    "Hornbuckle, Kylan",
    "Hubbard, Ian",
    "Killeffer, James",
    "Kilgore, Tanner",
    "Larsen, David",
    "Mangum, McCain",
    "Mutter, Evan",
    "Myers, Maddox",
    "Nathan, Cole",
    "Norris, Eli",
    "Pierce, Johno",
    "Ring, Alex",
    "Roberts, Braxton",
    "Rodriguez, Sebastian",
    "Rogers, Jacob",
    "Rosalia, Rob",
    "Rowland, Bryson",
    "Salicco, James",
    "Sharp, Will",
    "Shelton, Harrison",
    "Sims, Will",
    "Slifka, Denver",
    "Smith, Braxton",
    "Smith, Bryce",
    "Soto Diaz, Bradley",
    "Strittmatter, Sean",
    "Underwood, Jackson",
    "Van Ness, Jameson",
    "Vaughn, Peyton",
    "West, Ripken",
    "Wilson, Alec",
    "Wyatt, Jack",
    "Yonts, Peyton"
  ),
  allowed_hitters = c(
    "Adams, Kyle",
    "Alexander, Trace",
    "Angel, Bransen",
    "Benner, Seth",
    "Bishop, Matthew",
    "Bobo, Aaron",
    "Bolton, Ryan",
    "Butler, Cameron",
    "Carruthers, Wade",
    "Casson, Kolton",
    "Cochran, Carson",
    "Copley, Tyson",
    "Croy, Isaac",
    "Culpepper, Brock",
    "Dobson, Devin",
    "Evans, Colton",
    "Fields, Boone",
    "Fletcher, Drew",
    "Floyd, Logan",
    "Gibson, Aiden",
    "Greene, Maddox",
    "Griner, Gavin",
    "Hall, Cameron",
    "Hammond, Kevin",
    "Henderson, Christian",
    "Higgins, Ryan",
    "Hoffman, Wyatt",
    "Hornbuckle, Kylan",
    "Hubbard, Ian",
    "Killeffer, James",
    "Kilgore, Tanner",
    "Larsen, David",
    "Mangum, McCain",
    "Mutter, Evan",
    "Myers, Maddox",
    "Nathan, Cole",
    "Norris, Eli",
    "Pierce, Johno",
    "Ring, Alex",
    "Roberts, Braxton",
    "Rodriguez, Sebastian",
    "Rogers, Jacob",
    "Rosalia, Rob",
    "Rowland, Bryson",
    "Salicco, James",
    "Sharp, Will",
    "Shelton, Harrison",
    "Sims, Will",
    "Slifka, Denver",
    "Smith, Braxton",
    "Smith, Bryce",
    "Soto Diaz, Bradley",
    "Strittmatter, Sean",
    "Underwood, Jackson",
    "Van Ness, Jameson",
    "Vaughn, Peyton",
    "West, Ripken",
    "Wilson, Alec",
    "Wyatt, Jack",
    "Yonts, Peyton"
  ),
  allowed_campers = c(

  ),
  colors = list(
    primary             = "#0b233f",   # sampled from CNlogo navy
    accent              = "#f26829",   # sampled from CNlogo orange
    accent_secondary    = "#d95b22",   # darker orange companion for gradients
    background          = "#f5f5f5",   # neutral light background aligned to logo whites
    background_secondary= "#e8ebef"    # soft secondary neutral
    
  ),
  logo = "CNlogo.png",
  # Optional: Custom Reports page only (light mode + light PDF) alternate right-side logo.
  # If omitted or file is missing in /www, app automatically falls back to `logo`.
  custom_reports_light_logo = "CNlogo.png",
  coaches_emails = c(
    "Jwhite1@cn.edu",
    "tgriffin@cn.edu"
  ),
  notes_api = list(
    base_url = "https://script.google.com/macros/s/AKfycbwVUTGQybFrHjsyGGAwrzwAfTuibUA47g1C_Y0bdVB5LQJqObtpiR3oB9lKRYR2loiX/exec",
    token = "CNUbaseball"
  ),
  extra = list(
    school_name = "CNU",
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
