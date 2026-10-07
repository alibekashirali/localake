"""DuckDB engine: view registration, query execution, cancellation, paging."""

from __future__ import annotations

import json
import logging
import threading
import time
from pathlib import Path
from uuid import uuid4
from typing import TYPE_CHECKING, Any

import duckdb

from ..config import DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT
from ..project import Project
from .results import (
    RESULTS_DB,
    Page,
    ResultHandle,
    ResultStore,
    build_page_sql,
    quote_ident,
    quote_literal,
    slice_memory_rows,
)
from .serialize import columns_from_description, rows_to_jsonable

if TYPE_CHECKING:  # avoids a cycle: the catalog package imports this module
    from ..catalog.types import Dataset

log = logging.getLogger(__name__)


class QueryCancelled(Exception):
    """The user pressed Stop, or the tab was closed mid-flight."""


class QueryFailed(Exception):
    """DuckDB rejected the query; ``message`` is safe to show in the UI."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


def _reader_expression(dataset: "Dataset") -> str:
    """The DuckDB table function that exposes ``dataset`` as rows."""
    if dataset.partitioned:
        pattern = str(Path(dataset.abs_path) / "**" / "*.parquet")
        return f"read_parquet({quote_literal(pattern)}, hive_partitioning = true, union_by_name = true)"
    path = quote_literal(dataset.abs_path)
    if dataset.format == "parquet":
        return f"read_parquet({path})"
    if dataset.format == "csv":
        return f"read_csv_auto({path}, sample_size = 20000)"
    return f"read_json_auto({path})"


class Engine:
    """Owns the project's DuckDB connection and everything that runs on it."""

    def __init__(self, project: Project) -> None:
        self.project = project
        project.meta_dir.mkdir(parents=True, exist_ok=True)
        # The catalog is pure derived state — every view is rebuilt from the
        # filesystem scan on startup — so it lives in memory. That keeps a
        # binary out of the user's data folder and, more importantly, lets two
        # Localake instances open the same project: DuckDB takes an exclusive
        # lock on a database file and the second one would fail to start.
        self._conn = duckdb.connect()
        self._conn.execute(f"ATTACH ':memory:' AS {quote_ident(RESULTS_DB)}")
        # DuckDB spills large joins and sorts to disk. Its default for an
        # in-memory database is the relative path ".tmp", which lands wherever
        # the user happened to run the command; pin it inside the project.
        spill = project.meta_dir / "tmp"
        spill.mkdir(parents=True, exist_ok=True)
        self._conn.execute(f"SET temp_directory = {quote_literal(str(spill))}")
        self.results = ResultStore()
        self._running: dict[str, duckdb.DuckDBPyConnection] = {}
        self._cancelled: set[str] = set()
        #: Views this engine created, so a rescan never drops a user's own view.
        self._managed: set[tuple[str, str]] = set()
        self._lock = threading.Lock()

    def close(self) -> None:
        with self._lock:
            for cursor in self._running.values():
                try:
                    cursor.interrupt()
                except duckdb.Error:
                    pass
            self._running.clear()
        self._conn.close()

    # -- catalog -----------------------------------------------------------

    def register_datasets(self, datasets: dict[str, "Dataset"]) -> None:
        """(Re)create one view per dataset so SQL can address files by name."""
        cursor = self._conn.cursor()
        wanted: dict[str, set[str]] = {}
        for dataset in datasets.values():
            wanted.setdefault(dataset.schema_name, set()).add(dataset.table_name)

        for schema in wanted:
            cursor.execute(f"CREATE SCHEMA IF NOT EXISTS {quote_ident(schema)}")

        for dataset in datasets.values():
            statement = (
                f"CREATE OR REPLACE VIEW {dataset.qualified_name} AS "
                f"SELECT * FROM {_reader_expression(dataset)}"
            )
            try:
                cursor.execute(statement)
                dataset.error = None
            except duckdb.Error as exc:
                # One unreadable file must not abort the whole catalog refresh.
                dataset.error = str(exc).strip().splitlines()[0]
                log.warning("could not register %s: %s", dataset.path, dataset.error)

        self._drop_stale_views(cursor, wanted)

    def _drop_stale_views(
        self, cursor: duckdb.DuckDBPyConnection, wanted: dict[str, set[str]]
    ) -> None:
        """Remove views for files that have since been deleted or renamed.

        Only views this engine registered are considered, so a ``CREATE VIEW``
        typed into the SQL editor survives a rescan.
        """
        current = {
            (schema, table) for schema, tables in wanted.items() for table in tables
        }
        for schema, view in self._managed - current:
            cursor.execute(f"DROP VIEW IF EXISTS {quote_ident(schema)}.{quote_ident(view)}")
        self._managed = current

    def lock_external_access(self, allowed_root: str | Path) -> None:
        """Restrict the SQL editor to one directory while keeping the catalog alive.

        A bare ``SET enable_external_access = false`` would also stop the
        catalog's own ``read_parquet``/``read_csv`` views from re-registering on
        the next rescan, so the project root is added to ``allowed_directories``
        first. DuckDB freezes ``allowed_directories`` once external access is
        off, so the call is idempotent: the second time the list is left as-is.
        """
        with self._lock:
            try:
                self._conn.execute(
                    f"SET allowed_directories = [{quote_literal(str(allowed_root))}]"
                )
            except duckdb.Error:
                # Already locked; the directory list can no longer be changed.
                pass
            self._conn.execute("SET enable_external_access = false")

    def cursor(self) -> duckdb.DuckDBPyConnection:
        return self._conn.cursor()

    def sql(self, statement: str, params: list[Any] | None = None) -> tuple[list, list]:
        """Run an internal (non-user) statement and return ``(rows, columns)``."""
        cursor = self._conn.cursor()
        try:
            cursor.execute(statement, params or [])
        except duckdb.Error as exc:
            raise QueryFailed(_clean_error(exc)) from exc
        columns = columns_from_description(cursor.description)
        rows = rows_to_jsonable(cursor.fetchall()) if cursor.description else []
        return rows, columns

    def run_cell(self, sql: str, limit: int = 1000) -> dict[str, Any]:
        """Run a notebook cell synchronously and return a bounded result.

        Unlike :meth:`execute`, this does not materialise into the results
        database or register a cancellable run — a cell wants a quick,
        self-contained answer rather than a pageable, sortable result set.
        """
        statements = self._split(sql)
        if not statements:
            raise QueryFailed("Query is empty")
        row_limit = _clamp_limit(limit)
        cursor = self._conn.cursor()
        try:
            for statement in statements[:-1]:
                cursor.execute(statement.query)
            final = statements[-1]
            cursor.execute(final.query.strip().rstrip(";"))
            if final.type != duckdb.StatementType.SELECT:
                # DDL/DML report a one-cell "Count"; a notebook cell shows a
                # status message instead of a single-column grid.
                return {
                    "columns": [],
                    "rows": [],
                    "rowCount": 0,
                    "truncated": False,
                    "message": _statement_message(final.type),
                }
            if cursor.description is None:
                return {
                    "columns": [],
                    "rows": [],
                    "rowCount": 0,
                    "truncated": False,
                    "message": None,
                }
            raw = cursor.fetchmany(row_limit + 1)
            rows = rows_to_jsonable(raw[:row_limit])
            return {
                "columns": columns_from_description(cursor.description),
                "rows": rows,
                "rowCount": len(rows),
                "truncated": len(raw) > row_limit,
                "message": None,
            }
        except duckdb.Error as exc:
            raise QueryFailed(_clean_error(exc)) from exc

    # -- execution ---------------------------------------------------------

    def execute(self, sql: str, *, query_id: str, limit: int | None = None) -> ResultHandle:
        """Run user SQL and materialise the result. Blocking; call in a thread."""
        statements = self._split(sql)
        if not statements:
            raise QueryFailed("Query is empty")

        row_limit = _clamp_limit(limit)
        cursor = self._conn.cursor()
        with self._lock:
            if query_id in self._cancelled:
                self._cancelled.discard(query_id)
                raise QueryCancelled()
            self._running[query_id] = cursor

        started = time.perf_counter()
        try:
            for statement in statements[:-1]:
                cursor.execute(statement.query)
            handle = self._run_final(cursor, statements[-1], query_id, row_limit)
        except duckdb.InterruptException as exc:
            raise QueryCancelled() from exc
        except duckdb.Error as exc:
            if self._take_cancelled(query_id):
                raise QueryCancelled() from exc
            raise QueryFailed(_clean_error(exc)) from exc
        finally:
            with self._lock:
                self._running.pop(query_id, None)
                self._cancelled.discard(query_id)

        handle.elapsed_ms = (time.perf_counter() - started) * 1000
        handle.statements = len(statements)
        self.results.put(handle)
        return handle

    def _split(self, sql: str) -> list[Any]:
        try:
            return list(self._conn.extract_statements(sql))
        except duckdb.Error as exc:
            raise QueryFailed(_clean_error(exc)) from exc

    def _run_final(
        self,
        cursor: duckdb.DuckDBPyConnection,
        statement: Any,
        query_id: str,
        row_limit: int,
    ) -> ResultHandle:
        text = statement.query.strip().rstrip(";")
        table = f"res_{query_id.replace('-', '')}"

        if statement.type == duckdb.StatementType.SELECT:
            try:
                return self._materialise(cursor, text, table, query_id, row_limit)
            except duckdb.InterruptException:
                raise
            except duckdb.Error as exc:
                # Duplicate column names and a few exotic shapes cannot become a
                # table. A SELECT has no side effects, so re-running is safe.
                log.debug("falling back to in-memory result for %s: %s", query_id, exc)

        return self._collect(cursor, text, query_id, row_limit, statement.type)

    def _materialise(
        self,
        cursor: duckdb.DuckDBPyConnection,
        text: str,
        table: str,
        query_id: str,
        row_limit: int,
    ) -> ResultHandle:
        qualified = f"{quote_ident(RESULTS_DB)}.main.{quote_ident(table)}"
        # Fetch one row past the cap so we can tell the user the view is partial.
        cursor.execute(
            f"CREATE OR REPLACE TABLE {qualified} AS "
            f"SELECT * FROM ({text}) AS _localake_q LIMIT {row_limit + 1}"
        )
        total = cursor.execute(f"SELECT count(*) FROM {qualified}").fetchone()[0]
        truncated = total > row_limit
        if truncated:
            # Drop the probe row so every later count and page is exact.
            cursor.execute(f"DELETE FROM {qualified} WHERE rowid >= {row_limit}")
            total = row_limit
        columns = cursor.execute(f"SELECT * FROM {qualified} LIMIT 0").description
        return ResultHandle(
            query_id=query_id,
            columns=columns_from_description(columns),
            row_count=total,
            truncated=truncated,
            elapsed_ms=0.0,
            table=table,
        )

    def _collect(
        self,
        cursor: duckdb.DuckDBPyConnection,
        text: str,
        query_id: str,
        row_limit: int,
        statement_type: Any,
    ) -> ResultHandle:
        cursor.execute(text)
        is_select = statement_type == duckdb.StatementType.SELECT
        # DDL and DML still report a one-cell "Count"; that is a status, not data.
        message = None if is_select else _statement_message(statement_type)
        if cursor.description is None:
            return ResultHandle(
                query_id=query_id,
                columns=[],
                row_count=0,
                truncated=False,
                elapsed_ms=0.0,
                message=message,
            )
        raw = cursor.fetchmany(row_limit + 1)
        return ResultHandle(
            query_id=query_id,
            columns=columns_from_description(cursor.description),
            row_count=min(len(raw), row_limit),
            truncated=len(raw) > row_limit,
            elapsed_ms=0.0,
            rows=rows_to_jsonable(raw[:row_limit]),
            message=message,
        )

    def explain(self, sql: str) -> str:
        """Physical plan for the final statement, as DuckDB prints it."""
        statements = self._split(sql)
        if not statements:
            raise QueryFailed("Query is empty")
        text = statements[-1].query.strip().rstrip(";")
        cursor = self._conn.cursor()
        try:
            rows = cursor.execute(f"EXPLAIN {text}").fetchall()
        except duckdb.Error as exc:
            raise QueryFailed(_clean_error(exc)) from exc
        # EXPLAIN yields (key, value) pairs; the physical plan is the useful one.
        for key, value in rows:
            if "physical_plan" in str(key):
                return str(value)
        return "\n".join(str(value) for _, value in rows)

    def progress(self, query_id: str) -> float | None:
        """Completion percentage of a running query, when DuckDB can estimate it.

        Table functions such as ``range()`` have no known cardinality and report
        -1; a scan over real files does report progress.
        """
        with self._lock:
            cursor = self._running.get(query_id)
        if cursor is None:
            return None
        try:
            value = cursor.query_progress()
        except (duckdb.Error, AttributeError):
            return None
        percent = getattr(value, "percentage", value)
        try:
            percent = float(percent)
        except (TypeError, ValueError):
            return None
        return percent if 0.0 <= percent <= 100.0 else None

    def analyze(self, sql: str) -> dict[str, Any]:
        """Run the query under profiling and report what it actually read.

        DuckDB's JSON profile is used rather than ``EXPLAIN ANALYZE``: the text
        form is a box-drawing tree whose parallel branches interleave when
        flattened, so a join's scans cannot be read back reliably.
        """
        statements = self._split(sql)
        if not statements:
            raise QueryFailed("Query is empty")
        text = statements[-1].query.strip().rstrip(";")

        destination = self.project.meta_dir / "tmp" / f"profile_{uuid4().hex}.json"
        destination.parent.mkdir(parents=True, exist_ok=True)
        cursor = self._conn.cursor()
        try:
            cursor.execute("PRAGMA enable_profiling='json'")
            cursor.execute(f"PRAGMA profiling_output={quote_literal(str(destination))}")
            cursor.execute(text).fetchall()
        except duckdb.Error as exc:
            raise QueryFailed(_clean_error(exc)) from exc
        finally:
            try:
                cursor.execute("PRAGMA disable_profiling")
            except duckdb.Error:
                pass

        try:
            profile = json.loads(destination.read_text())
        except (OSError, json.JSONDecodeError):
            return {"rowsScanned": None, "bytesRead": None, "operators": []}
        finally:
            destination.unlink(missing_ok=True)

        operators: list[dict[str, Any]] = []
        _collect_operators(profile, operators)
        scanned = sum(
            op["rows"] for op in operators if op["scan"] and op["rows"] is not None
        )
        return {
            "rowsScanned": scanned or None,
            "bytesRead": profile.get("total_bytes_read") or None,
            "operators": operators[:40],
        }

    def cancel(self, query_id: str) -> bool:
        """Interrupt a running query. Safe to call before it even starts."""
        with self._lock:
            cursor = self._running.get(query_id)
            self._cancelled.add(query_id)
        if cursor is None:
            return False
        try:
            cursor.interrupt()
        except duckdb.Error:
            return False
        return True

    def _take_cancelled(self, query_id: str) -> bool:
        with self._lock:
            return query_id in self._cancelled

    # -- paging ------------------------------------------------------------

    def page(
        self,
        query_id: str,
        *,
        offset: int = 0,
        limit: int = 100,
        sort: str | None = None,
        descending: bool = False,
        search: str | None = None,
    ) -> Page | None:
        handle = self.results.get(query_id)
        if handle is None:
            return None
        limit = max(1, min(limit, 5000))
        offset = max(0, offset)

        if handle.table is None:
            return slice_memory_rows(
                handle, offset=offset, limit=limit, sort=sort,
                descending=descending, search=search,
            )

        rows_sql, count_sql = build_page_sql(
            handle, offset=offset, limit=limit, sort=sort,
            descending=descending, search=search,
        )
        cursor = self._conn.cursor()
        try:
            total = cursor.execute(count_sql).fetchone()[0]
            rows = cursor.execute(rows_sql).fetchall()
        except duckdb.Error as exc:
            raise QueryFailed(_clean_error(exc)) from exc
        return Page(rows=rows_to_jsonable(rows), offset=offset, total=total)

    def release(self, query_id: str) -> None:
        """Drop a result set when its tab closes."""
        handle = self.results.pop(query_id)
        if handle is None or handle.table is None:
            return
        try:
            self._conn.execute(f"DROP TABLE IF EXISTS {handle.qualified_table}")
        except duckdb.Error:
            pass


def _clamp_limit(limit: int | None) -> int:
    if limit is None:
        return DEFAULT_QUERY_LIMIT
    return max(1, min(int(limit), MAX_QUERY_LIMIT))


def _clean_error(exc: Exception) -> str:
    """DuckDB errors carry a helpful first line and a noisy tail."""
    text = str(exc).strip()
    for prefix in ("Binder Error: ", "Catalog Error: ", "Parser Error: ", "Conversion Error: "):
        if text.startswith(prefix):
            text = text[len(prefix) :]
            break
    lines = [line for line in text.splitlines() if line.strip()]
    if not lines:
        return "Query failed"
    if len(lines) > 1 and lines[1].startswith("LINE"):
        return f"{lines[0]} ({lines[1].strip()})"
    return lines[0]


def _collect_operators(node: Any, out: list[dict[str, Any]], depth: int = 0) -> None:
    """Flatten the profile tree into rows the Execution tab can list."""
    if not isinstance(node, dict):
        return
    name = node.get("operator_type") or node.get("operator_name")
    if name:
        extra = node.get("extra_info")
        detail = None
        if isinstance(extra, dict):
            detail = extra.get("Table") or extra.get("Text") or extra.get("Function")
        out.append(
            {
                "name": str(name),
                "rows": node.get("operator_cardinality"),
                "timing": node.get("operator_timing"),
                "detail": str(detail) if detail else None,
                "depth": depth,
                # A constant projection reads nothing off storage.
                "scan": str(name).endswith("_SCAN") and name != "DUMMY_SCAN",
            }
        )
        depth += 1
    for child in node.get("children", []) or []:
        _collect_operators(child, out, depth)


def _statement_message(statement_type: Any) -> str:
    name = getattr(statement_type, "name", "STATEMENT").replace("_", " ").title()
    return f"{name} statement executed"
