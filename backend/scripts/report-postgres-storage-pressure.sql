-- Read-only PostgreSQL storage-pressure report for maintenance planning.
-- Usage:
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 \
--     -f backend/scripts/report-postgres-storage-pressure.sql
--
-- n_dead_tup and bytes_per_live_row are estimates. Use them to identify
-- candidates for a separately approved VACUUM/REINDEX investigation; this
-- report never performs maintenance or deletes data.

\pset pager off
\pset null '(null)'
\timing on

BEGIN READ ONLY;

SELECT
  current_database() AS database_name,
  pg_size_pretty(pg_database_size(current_database())) AS database_size,
  now() AS observed_at;

WITH relation_pressure AS (
  SELECT
    s.schemaname,
    s.relname,
    s.n_live_tup,
    s.n_dead_tup,
    CASE
      WHEN s.n_live_tup + s.n_dead_tup = 0 THEN 0
      ELSE round(100.0 * s.n_dead_tup / (s.n_live_tup + s.n_dead_tup), 2)
    END AS dead_tuple_percent,
    pg_table_size(s.relid) AS table_bytes,
    pg_indexes_size(s.relid) AS index_bytes,
    pg_total_relation_size(s.relid) AS total_bytes,
    CASE
      WHEN s.n_live_tup = 0 THEN NULL
      ELSE pg_total_relation_size(s.relid) / s.n_live_tup
    END AS bytes_per_live_row,
    s.last_vacuum,
    s.last_autovacuum,
    s.last_analyze,
    s.last_autoanalyze
  FROM pg_stat_user_tables AS s
)
SELECT
  schemaname,
  relname,
  n_live_tup,
  n_dead_tup,
  dead_tuple_percent,
  pg_size_pretty(table_bytes) AS table_size,
  pg_size_pretty(index_bytes) AS index_size,
  pg_size_pretty(total_bytes) AS total_size,
  bytes_per_live_row,
  last_vacuum,
  last_autovacuum,
  last_analyze,
  last_autoanalyze
FROM relation_pressure
ORDER BY total_bytes DESC, n_dead_tup DESC
LIMIT 50;

SELECT
  schemaname,
  relname,
  n_live_tup,
  n_dead_tup,
  CASE
    WHEN n_live_tup + n_dead_tup = 0 THEN 0
    ELSE round(100.0 * n_dead_tup / (n_live_tup + n_dead_tup), 2)
  END AS dead_tuple_percent,
  autovacuum_count,
  autoanalyze_count,
  last_autovacuum,
  last_autoanalyze
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC, relname
LIMIT 50;

ROLLBACK;
