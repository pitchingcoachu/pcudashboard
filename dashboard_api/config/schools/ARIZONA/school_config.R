# University of Arizona dashboard configuration.
school_config <- list(
  team_code = "ARIZONA",
  team_code_markers = c("ARI_WIL", "ARI_WPR", "ARIZONA"),
  allowed_pitchers = c(
    "Adams, TJ", "Antigua, Ariel", "Bailey, Smith", "Ball, Ben",
    "Baumler, Trever", "Bowers, Robert", "Brandt, Evan", "Brennan, Cash",
    "Breyfogle, Easton", "Byers, Jack", "Cain, Andrew", "Crocker, Jory",
    "Danzeisen, Caleb", "Deome, Ayden", "Drake, JT", "Forbes, Joe",
    "Guzman, Randy", "Hickman, Benton", "Hicks, Garrett", "Hunt, James",
    "Kinkaid, Charlie", "Kruk, Cooper", "Lafflam, Jack", "Lee, Lyndon",
    "Lira, Tony", "Maize, Matthew", "McEntire, Carson", "Novitske, Nate",
    "O'Rourke, Quinn", "Pascanu, Tommy", "Penzkover, Gunnar", "Pluta, Tony",
    "Roberts, Maclain", "Russell, Tyler", "Sherrin, Abram", "Sylvester, Beau",
    "Triezenberg, Gavin", "Ward, Drew", "Weekly, Dylan"
  ),
  allowed_hitters = c(
    "Adams, TJ", "Antigua, Ariel", "Bailey, Smith", "Ball, Ben",
    "Baumler, Trever", "Bowers, Robert", "Brandt, Evan", "Brennan, Cash",
    "Breyfogle, Easton", "Byers, Jack", "Cain, Andrew", "Crocker, Jory",
    "Danzeisen, Caleb", "Deome, Ayden", "Drake, JT", "Forbes, Joe",
    "Guzman, Randy", "Hickman, Benton", "Hicks, Garrett", "Hunt, James",
    "Kinkaid, Charlie", "Kruk, Cooper", "Lafflam, Jack", "Lee, Lyndon",
    "Lira, Tony", "Maize, Matthew", "McEntire, Carson", "Novitske, Nate",
    "O'Rourke, Quinn", "Pascanu, Tommy", "Penzkover, Gunnar", "Pluta, Tony",
    "Roberts, Maclain", "Russell, Tyler", "Sherrin, Abram", "Sylvester, Beau",
    "Triezenberg, Gavin", "Ward, Drew", "Weekly, Dylan"
  ),
  allowed_campers = c(),
  colors = list(
    primary              = "#AB0520",
    accent               = "#AB0520",
    accent_secondary     = "#0C234B",
    background           = "#FFFFFF",
    background_secondary = "#F4F6F9"
  ),
  logo = "arizona-logo-v2.png",
  coaches_emails = c(
    "chale8@arizona.edu", "rcouch1@arizona.edu", "ellawolters@arizona.edu",
    "seankenny@arizona.edu", "jmeggs@arizona.edu", "swinston@arizona.edu",
    "gcaulfield3@arizona.edu", "danielmolinari@arizona.edu",
    "jalenborders32@arizona.edu", "ofavela91@arizona.edu"
  ),
  notes_api = list(
    base_url = "",
    token = "arizonabaseball"
  ),
  extra = list(
    school_name = "University of Arizona",
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
