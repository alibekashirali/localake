# Contributing

## Setup

```bash
uv sync --group dev                 # backend and tests; Node is not needed here
cd frontend && npm install && cd ..
```

## Running it

Two terminals give you hot reload on both sides:

```bash
uv run localake ~/Data/ecommerce --reload --port 8787   # terminal 1
cd frontend && npm run dev                               # terminal 2
```

The Vite dev server on `:5173` proxies `/api` and `/ws` to the backend. To work
against the production build instead, run `npm run build` and use
`uv run localake ~/Data/ecommerce`, which serves `frontend/dist`.

No data of your own? `python scripts/make_sample_project.py ~/Data/ecommerce`
builds a small ecommerce project with Parquet, CSV, JSON and a Hive-partitioned
directory.

## Checks

```bash
uv run pytest                       # backend
cd frontend && npm run typecheck    # frontend
```

Both run in CI on every pull request, along with a frontend build.

## Layout

```
backend/localake/
  api/         HTTP and WebSocket routes
  catalog/     filesystem scan, schema, profiling
  query/       DuckDB engine, result store, serialisation
  lineage/     SQL parsing into a graph
  project/     lakehouse.toml and paths
  storage/     JSON metadata under .localake/
frontend/src/
  features/    one directory per screen
  components/  shared primitives
  lib/         API client, formatting, chart options
```

## Things worth knowing before you change them

- **The catalog database is in memory on purpose.** It is rebuilt from the
  filesystem at startup, which keeps binaries out of the user's data folder and
  lets two instances open the same project. A file-backed DuckDB takes an
  exclusive lock and the second instance would not start.
- **`CAST(x AS INTEGER)` rounds in DuckDB**, it does not truncate. Use `floor()`
  when bucketing; this has caused two real bugs already.
- **Results are materialised into an attached in-memory database.** Sorting,
  filtering, paging, charting and export are SQL against that table, so they
  never re-run the user's query. Keep it that way.
- **Nothing may reach the network at runtime.** Monaco and the fonts are
  bundled. A CDN import would break the product's central promise.
- The wheel carries the compiled interface (`localake/web/`) via the build hook
  in `scripts/hatch_build.py`, so installed users never need Node. The hook
  deliberately does nothing for editable installs.

## Commits and pull requests

Small and focused. A behaviour change wants a test next to it: `tests/test_api.py`
covers the API end to end against a temporary project, which is usually the
cheapest place to prove something works.
