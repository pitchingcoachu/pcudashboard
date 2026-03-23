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

kv <- read_cfg("/Users/jaredgaynor/Documents/GitHub/oklahomastate/auth_db_config.yml")
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

cat("=== Auth users for jgaynor@pitchingcoachu.com ===\n")
print(
  dbGetQuery(
    con,
    "
    SELECT id, email, role, organization_id, is_active, updated_at
    FROM auth_users
    WHERE lower(email) = lower('jgaynor@pitchingcoachu.com')
    ORDER BY id
    "
  )
)

cat("\n=== Organizations ===\n")
print(
  dbGetQuery(
    con,
    "
    SELECT id, name, updated_at
    FROM organizations
    ORDER BY id
    "
  )
)

cat("\n=== Bullpen Summary rows ===\n")
print(
  dbGetQuery(
    con,
    "
    SELECT id, organization_id, school_code, applies_to_all_schools, name, updated_at
    FROM dashboard_custom_reports
    WHERE lower(name) = lower('Bullpen Summary Report')
    ORDER BY organization_id, school_code, applies_to_all_schools
    "
  )
)
