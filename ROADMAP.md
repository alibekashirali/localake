# Roadmap

Status against [the technical specification](Localake_Technical_Specification.md).

## Working today

| Area | |
|---|---|
| Project | Opens any folder, writes `lakehouse.toml`, switches between recent projects |
| Catalog | Parquet, CSV, JSON; Hive-partitioned directories and multi-part Parquet collapse into one table; rescans on file change |
| Explorer | Tree beside the editor, plus a sortable catalog of every dataset |
| SQL editor | Monaco, catalog-driven autocomplete, multiple tabs, formatting, `⌘↵` to run, Stop to interrupt |
| Results | Virtualized grid, server-side sort and filter, CSV/JSON export; results are materialised once so paging never re-runs the query |
| Execution | Time, rows scanned off storage, bytes read, and a drawn operator tree |
| Inspector | Schema with null rates from Parquet footers, `SUMMARIZE` profiling with histograms and top values, preview, lineage |
| Charts | Quick chart beside the editor, full axis control; saved as JSON files in the project so they can be committed |
| Lineage | Files → tables → views → queries → charts, parsed from SQL with sqlglot |
| History | Every run with duration and row count, grouped by day; search and date filters |
| Search | `⌘K` over tables, columns, queries, charts, files and projects |
| Settings | DuckDB memory and threads, spill directory, row limit, file-access lockdown |
| Import | Upload a Parquet, CSV or JSON file into a project folder and it becomes a queryable dataset immediately |
| Notebooks | Ordered SQL cells over the shared DuckDB session, saved as JSON files in the project |

## Next

- **Connectors** — Postgres, MySQL, S3/MinIO. The `Imports` screen now uploads
  files; the remaining value here is remote sources rather than an upload button
- **Profile** — distinct-value sketches on very wide tables

## Later

- Delta Lake and Iceberg, with time travel
- An AI copilot that reads the local schema, writes SQL, runs it, and charts the
  result (§30 of the specification)
- A dark theme — the toggle was removed rather than left dead; the colour tokens
  exist, the hardcoded utility classes need replacing first

## Not planned

- **A hosted or multi-user version.** Localake shares one DuckDB instance and
  gives the SQL editor full filesystem access; see [SECURITY.md](SECURITY.md).
  Serving several people would be a different product, not a flag.
- **Telemetry.**
