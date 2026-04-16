library(DBI)
library(RPostgres)

read_cfg <- function(path) {
  lines <- readLines(path, warn = FALSE)
  kv <- list()
  for (ln in lines) {
    m <- regexec("^([A-Za-z0-9_]+):\\s*(.*)$", ln)
    r <- regmatches(ln, m)[[1]]
    if (length(r) == 3) kv[[r[2]]] <- r[3]
  }
  kv
}

kv <- read_cfg("/Users/jaredgaynor/Documents/GitHub/pcu/auth_db_config.yml")
con <- dbConnect(
  Postgres(),
  host = kv$host,
  port = as.integer(kv$port),
  dbname = kv$dbname,
  user = kv$user,
  password = kv$password,
  sslmode = kv$sslmode
)
on.exit(DBI::dbDisconnect(con), add = TRUE)

where_sql <- "lower(btrim(name)) in (lower($$Hitter's Advance vs. RHP$$), lower($$Location Heatmaps$$), lower($$Pitching Summary (Team)$$))"

before <- dbGetQuery(
  con,
  paste0(
    "SELECT id, organization_id, school_code, applies_to_all_schools, name, updated_at ",
    "FROM dashboard_custom_reports ",
    "WHERE ",
    where_sql,
    " ORDER BY updated_at DESC, id DESC"
  )
)

cat("Rows matching before delete:", nrow(before), "\n")
if (nrow(before) > 0) print(before)

deleted <- dbGetQuery(
  con,
  paste0(
    "DELETE FROM dashboard_custom_reports ",
    "WHERE ",
    where_sql,
    " RETURNING id, organization_id, school_code, applies_to_all_schools, name, updated_at"
  )
)

cat("Rows deleted:", nrow(deleted), "\n")
if (nrow(deleted) > 0) print(deleted)
