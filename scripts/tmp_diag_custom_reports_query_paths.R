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

schools <- c("PCU", "OSU", "CNU", "GCU", "LSU", "SEMO")
contexts <- list(
  list(org = 1L, orgs = c(1L), broaden = TRUE, label = "org1 broaden"),
  list(org = 0L, orgs = integer(0), broaden = TRUE, label = "org0 broaden"),
  list(org = 0L, orgs = c(1L), broaden = TRUE, label = "org0 with org1 broaden"),
  list(org = 1L, orgs = c(1L), broaden = FALSE, label = "org1 no-broaden")
)

cat("=== Rows in dashboard_custom_reports ===\n")
print(dbGetQuery(con, "SELECT id, organization_id, school_code, applies_to_all_schools, name FROM dashboard_custom_reports ORDER BY id"))

for (ctx in contexts) {
  cat("\n--- Context:", ctx$label, "---\n")
  for (sc in schools) {
    rows <- dbGetQuery(
      con,
      "
      SELECT id, name, applies_to_all_schools, school_code, organization_id
      FROM dashboard_custom_reports
      WHERE ((school_code = $2) AND (organization_id = $1 OR organization_id = ANY($3::int[]) OR $4::boolean))
         OR (applies_to_all_schools = TRUE AND (organization_id = ANY($3::int[]) OR $4::boolean))
      ORDER BY updated_at DESC, id DESC
      ",
      params = list(ctx$org, sc, as.integer(ctx$orgs), ctx$broaden)
    )
    cat(sc, "=>", nrow(rows), "rows")
    if (nrow(rows) > 0) {
      cat(" | top:", rows$name[[1]], "| org", rows$organization_id[[1]], "| school", rows$school_code[[1]], "| all", rows$applies_to_all_schools[[1]])
    }
    cat("\n")
  }
}
