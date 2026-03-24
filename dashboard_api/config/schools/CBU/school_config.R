# School-specific overrides for the shared app.
# Copy this file to another repo and keep the same structure when you need to customize colors, logos, APIs, etc.
school_config <- list(
  team_code = "CBU",
  # Additional school-code markers used in TrackMan team columns (optional).
  # These are checked alongside team_code during allowed-player verification.
  team_code_markers = c("CAL_BAP", "CBU", "CAL_LAN"),
  allowed_pitchers = c(
    "Malki, Michael",
    "Hunsaker, Riley",
    "Toth, Diesel",
    "Orozco, Julian",
    "Smathers, Kody",
    "Peck, Bryan",
    "Becerra, Luis",
    "Smith, Noah",
    "Palmer, Ryne",
    "New, Cody",
    "Chavez, Nathan",
    "Capacete, Alfredo",
    "Yates, Zach",
    "Urquidi, Niko",
    "Carlson, John",
    "Rudd, Andrew",
    "Zack, Lucas",
    "Olsen, Carson",
    "Tucker, Carter",
    "Teper, Cameron",
    "Burgess, Sam"
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
    primary             = "#002554",   # deep navy inspired by CBU logo
    accent              = "#a07400",   # golden accent from logo
    accent_secondary    = "#001f3f",   # deep navy stop to avoid pure black
    background          = "#ffffff",   # clean white base
    background_secondary= "#f4f4f4"    # subtle off-white for panels
    
  ),
  logo = "CBUlogo.png",
  coaches_emails = c(
    "andalvarez@calbaptist.edu",
    "msilberman@calbaptist.edu"
  ),
  notes_api = list(
    base_url = "https://script.google.com/macros/s/AKfycbz_uwyiMbr_Wsj_bQLDJ082wXcgt94bk5HUUONVOy_FFrtnUb0Ikf0x0iIoqDj0FvWP/exec",
    token = "cbubaseball"
  ),
  extra = list(
    school_name = "cbu",
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
