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

q <- "
SELECT id, organization_id, school_code, applies_to_all_schools, name, updated_at
FROM dashboard_custom_reports
ORDER BY updated_at DESC
LIMIT 100
"
print(dbGetQuery(con, q))
