# School-specific overrides for the shared app.
# Copy this file to another repo and keep the same structure when you need to customize colors, logos, APIs, etc.
school_config <- list(
  team_code = "OSU",
  # Additional school-code markers used in TrackMan team columns (optional).
  # These are checked alongside team_code during allowed-player verification.
  team_code_markers = c("OKL_CPR", "OSU", "OKL_COW"),
  allowed_pitchers = c(
  "Wentworth, TP",
  "LeBlanc, Bryce",
  "Lund, Ethan",
  "Fyke, Kai",
  "Rhodes, Stormy",
  "Wech, Noah",
  "Brown, Matthew",
  "Phillips, Brennan",
  "Blake, Drew",
  "Glendinning, Lucas",
  "Golden, Josiah",
  "Kennedy, Jake",
  "Barrett, Hudson",
  "Zagar, Kyler",
  "Albright, Gaige",
  "Sramek, Caden",
  "Jennings, Parker",
  "Burns, Zane",
  "Winslow, Drew",
  "Pearcy, Kyle",
  "Turner, Cael",
  "Pesca, Mario",
  "Watkins, Hunter",
  "Thompson, Brock",
  "Meola, Aidan",
  "Bowen, Terrance",
  "Smithwick, Campbell",
  "Shull, Garrett",
  "Indomenico, Remo",
  "Ortiz, Avery",
  "Wallace, Danny",
  "Brueggemann, Colin",
  "Ritchie, Kollin",
  "Conover, Alex",
  "Norman, Sebastian",
  "Essex, Ezra",
  "Saunders, Evan",
  "Pladson, Cole",
  "Schambow, Quinn",
  "Kennedy, Ty",
  "Francisco, Brady",
  "Pomeroy, Deacon",
  "Kennedy, Jacob"
  ),
  allowed_hitters = c(
  "Wentworth, TP",
  "LeBlanc, Bryce",
  "Lund, Ethan",
  "Fyke, Kai",
  "Rhodes, Stormy",
  "Wech, Noah",
  "Brown, Matthew",
  "Phillips, Brennan",
  "Blake, Drew",
  "Glendinning, Lucas",
  "Golden, Josiah",
  "Kennedy, Jake",
  "Barrett, Hudson",
  "Zagar, Kyler",
  "Albright, Gaige",
  "Sramek, Caden",
  "Jennings, Parker",
  "Burns, Zane",
  "Winslow, Drew",
  "Pearcy, Kyle",
  "Turner, Cael",
  "Pesca, Mario",
  "Watkins, Hunter",
  "Thompson, Brock",
  "Meola, Aidan",
  "Bowen, Terrance",
  "Smithwick, Campbell",
  "Shull, Garrett",
  "Indomenico, Remo",
  "Ortiz, Avery",
  "Wallace, Danny",
  "Brueggemann, Colin",
  "Ritchie, Kollin",
  "Conover, Alex",
  "Norman, Sebastian",
  "Essex, Ezra",
  "Saunders, Evan",
  "Pladson, Cole",
  "Schambow, Quinn",
  "Kennedy, Ty",
  "Francisco, Brady",
  "Pomeroy, Deacon",
  "Kennedy, Jacob"
  ),
  allowed_campers = c(
  ),
  colors = list(
    primary             = "#231f20",   # deep charcoal from OSU logo
    accent              = "#fe5c00",   # bright orange highlight from logo
    accent_secondary    = "#e15404",   # warmer orange ensuring logo accuracy
    background          = "#ffffff",   # clean white page base
    background_secondary= "#f4f4f4"    # soft grey for panels
    
  ),
  logo = "OSUlogo.png",
  coaches_emails = c(
    "Blake.hawksworth@okstate.edu",
    "Payton.stevens@okstate.edu",
    "Trey.cobb@okstate.edu",
    "jared.s.gaynor@gmail.com",
    "Victor.Romero@okstate.edu",
    "J.Holliday@okstate.edu",
    "Mark.Ginther@okstate.edu",
    "hub.roberts@okstate.edu"
  ),
  notes_api = list(
    base_url = "https://script.google.com/macros/s/AKfycby8_RuLj5hKxi129ru32cpEojVimffD2msCSl-I9r9a1LfZe9Ht-yLPbiDHVatm48g/exec",
    token = "OSUbaseball"
  ),
  extra = list(
    school_name = "Oklahoma State",
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
