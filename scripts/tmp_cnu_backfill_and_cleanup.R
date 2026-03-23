library(DBI)
library(RPostgres)

school_code <- toupper(trimws(Sys.getenv("SCHOOL_CODE", "CNU")))
school_config_path <- Sys.getenv(
  "SCHOOL_CONFIG_PATH",
  file.path("/Users/jaredgaynor/Documents/GitHub/pcudashboard/dashboard_api/config/schools", school_code, "school_config.R")
)
db_config_path <- Sys.getenv(
  "DB_CONFIG_PATH",
  "/Users/jaredgaynor/Documents/GitHub/carsonnewman/auth_db_config.yml"
)

if (!file.exists(school_config_path)) stop("Missing SCHOOL_CONFIG_PATH: ", school_config_path)
if (!file.exists(db_config_path)) stop("Missing DB_CONFIG_PATH: ", db_config_path)

# Load school roster/markers
source(school_config_path)
team_code <- toupper(trimws(as.character(school_config$team_code)))
markers <- unique(toupper(trimws(c(team_code, school_config$team_code_markers, school_code))))
allowed_pitchers <- unique(trimws(school_config$allowed_pitchers))
allowed_hitters <- unique(trimws(school_config$allowed_hitters))

# Read DB config
cfg_lines <- readLines(db_config_path, warn = FALSE)
kv <- list()
for (ln in cfg_lines) {
  m <- regexec("^([A-Za-z0-9_]+):\\s*(.*)$", ln)
  r <- regmatches(ln, m)[[1]]
  if (length(r) == 3) kv[[r[2]]] <- r[3]
}

con <- dbConnect(
  Postgres(),
  host = kv$host,
  port = as.integer(kv$port),
  dbname = kv$dbname,
  user = kv$user,
  password = kv$password,
  sslmode = kv$sslmode
)
on.exit(dbDisconnect(con), add = TRUE)

qstr <- function(values) {
  if (length(values) == 0) return("''")
  paste(as.character(dbQuoteString(con, values)), collapse = ",")
}

markers_sql <- qstr(markers)
pitchers_sql <- qstr(allowed_pitchers)
hitters_sql <- qstr(allowed_hitters)
school_sql <- as.character(dbQuoteString(con, school_code))
team_sql <- as.character(dbQuoteString(con, team_code))

# 1) Backfill missing team columns from known CNU roster
u1 <- dbExecute(
  con,
  paste0("UPDATE pitch_events
   SET pitcherteam = ", team_sql, "
   WHERE school_code = ", school_sql, "
     AND COALESCE(BTRIM(pitcherteam), '') = ''
     AND COALESCE(BTRIM(pitcher), '') <> ''
     AND BTRIM(pitcher) IN (", pitchers_sql, ")")
)

u2 <- dbExecute(
  con,
  paste0("UPDATE pitch_events
   SET batterteam = ", team_sql, "
   WHERE school_code = ", school_sql, "
     AND COALESCE(BTRIM(batterteam), '') = ''
     AND COALESCE(BTRIM(batter), '') <> ''
     AND BTRIM(batter) IN (", hitters_sql, ")")
)

# 2) Opponent fill when opposite side is confirmed CNU
u3 <- dbExecute(
  con,
  paste0("UPDATE pitch_events
   SET batterteam = 'OPP'
   WHERE school_code = ", school_sql, "
     AND COALESCE(BTRIM(batterteam), '') = ''
     AND UPPER(BTRIM(COALESCE(pitcherteam, ''))) IN (", markers_sql, ")")
)

u4 <- dbExecute(
  con,
  paste0("UPDATE pitch_events
   SET pitcherteam = 'OPP'
   WHERE school_code = ", school_sql, "
     AND COALESCE(BTRIM(pitcherteam), '') = ''
     AND UPPER(BTRIM(COALESCE(batterteam, ''))) IN (", markers_sql, ")")
)

# 3) Cleanup rows unrelated to CNU after backfill
# Keep if any team column contains CNU marker OR roster name appears on either side
keep_where <- "(
  UPPER(BTRIM(COALESCE(pitcherteam, ''))) IN (%s)
  OR UPPER(BTRIM(COALESCE(batterteam, ''))) IN (%s)
  OR UPPER(BTRIM(COALESCE(hometeam, ''))) IN (%s)
  OR UPPER(BTRIM(COALESCE(awayteam, ''))) IN (%s)
  OR BTRIM(COALESCE(pitcher, '')) IN (%s)
  OR BTRIM(COALESCE(batter, '')) IN (%s)
)"

keep_where <- sprintf(
  keep_where,
  markers_sql, markers_sql, markers_sql, markers_sql, pitchers_sql, hitters_sql
)

del <- dbExecute(
  con,
  paste0("DELETE FROM pitch_events WHERE school_code = ", school_sql, " AND NOT ", keep_where)
)

# 4) quick summary
summary <- dbGetQuery(
  con,
  paste0("SELECT
     COUNT(*) AS total_rows,
     SUM(CASE WHEN UPPER(BTRIM(COALESCE(pitcherteam, ''))) IN (", markers_sql, ") THEN 1 ELSE 0 END) AS pitcher_marker_rows,
     SUM(CASE WHEN UPPER(BTRIM(COALESCE(batterteam, ''))) IN (", markers_sql, ") THEN 1 ELSE 0 END) AS batter_marker_rows,
     SUM(CASE WHEN UPPER(BTRIM(COALESCE(hometeam, ''))) IN (", markers_sql, ") THEN 1 ELSE 0 END) AS home_marker_rows,
     SUM(CASE WHEN UPPER(BTRIM(COALESCE(awayteam, ''))) IN (", markers_sql, ") THEN 1 ELSE 0 END) AS away_marker_rows
   FROM pitch_events
   WHERE school_code = ", school_sql)
)

cat(sprintf("School: %s | Team code: %s\n", school_code, team_code))
cat(sprintf("Backfill updates: pitcherteam=%d batterteam=%d opp_batter=%d opp_pitcher=%d\n", u1, u2, u3, u4))
cat(sprintf("Cleanup deleted rows: %d\n", del))
print(summary)
