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

targets <- data.frame(
  organization_id = c(1L, 2L, 5L, 6L, 7L, 8L),
  school_code = c("PCU", "OSU", "CNU", "GCU", "LSU", "SEMO"),
  stringsAsFactors = FALSE
)

src <- dbGetQuery(
  con,
  "SELECT name, payload_json, created_by_user_id
   FROM dashboard_custom_reports
   WHERE lower(name) = lower('Bullpen Summary Report')
   ORDER BY updated_at DESC
   LIMIT 1"
)
if (nrow(src) == 0) stop("Bullpen Summary Report not found")

for (i in seq_len(nrow(targets))) {
  org <- targets$organization_id[[i]]
  sch <- targets$school_code[[i]]
  dbExecute(
    con,
    "
    INSERT INTO dashboard_custom_reports (
      organization_id, school_code, applies_to_all_schools, name, payload_json, created_by_user_id
    )
    VALUES ($1, $2, FALSE, $3, $4::jsonb, $5)
    ON CONFLICT (organization_id, school_code, applies_to_all_schools, lower(name))
    DO UPDATE SET
      payload_json = EXCLUDED.payload_json,
      updated_at = NOW(),
      created_by_user_id = EXCLUDED.created_by_user_id
    ",
    params = list(org, sch, src$name[[1]], as.character(src$payload_json[[1]]), src$created_by_user_id[[1]])
  )
}

print(
  dbGetQuery(
    con,
    "SELECT organization_id, school_code, applies_to_all_schools, name, updated_at
     FROM dashboard_custom_reports
     WHERE lower(name) = lower('Bullpen Summary Report')
     ORDER BY organization_id, school_code, applies_to_all_schools"
  )
)
