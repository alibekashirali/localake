"""Result sets, kept around after execution so the grid can page without re-running.

Two backings exist. Most results are materialised into a table in an attached
in-memory database, which makes sorting, filtering and paging plain SQL. Results
that cannot be materialised (``EXPLAIN``, duplicate column names, DDL that still
returns rows) fall back to holding the rows in Python.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Any

RESULTS_DB = "localake_results"


def quote_ident(name: str) -> str:
    escaped = str(name).replace('"', '""')
    return f'"{escaped}"'


def quote_literal(value: str) -> str:
    escaped = str(value).replace("'", "''")
    return f"'{escaped}'"


@dataclass
class ResultHandle:
    query_id: str
    columns: list[dict[str, str]]
    row_count: int
    truncated: bool
    elapsed_ms: float
    table: str | None = None
    rows: list[list[Any]] | None = None
    message: str | None = None
    statements: int = 1

    @property
    def qualified_table(self) -> str | None:
        if self.table is None:
            return None
        return f"{quote_ident(RESULTS_DB)}.main.{quote_ident(self.table)}"

    def to_dict(self) -> dict[str, Any]:
        return {
            "queryId": self.query_id,
            "columns": self.columns,
            "rowCount": self.row_count,
            "truncated": self.truncated,
            "elapsedMs": round(self.elapsed_ms, 2),
            "message": self.message,
            "statements": self.statements,
        }


@dataclass
class Page:
    rows: list[list[Any]]
    offset: int
    total: int

    def to_dict(self) -> dict[str, Any]:
        return {"rows": self.rows, "offset": self.offset, "total": self.total}


class ResultStore:
    """Registry of live result sets, one per query tab."""

    def __init__(self) -> None:
        self._handles: dict[str, ResultHandle] = {}
        self._lock = threading.Lock()

    def put(self, handle: ResultHandle) -> None:
        with self._lock:
            self._handles[handle.query_id] = handle

    def get(self, query_id: str) -> ResultHandle | None:
        with self._lock:
            return self._handles.get(query_id)

    def pop(self, query_id: str) -> ResultHandle | None:
        with self._lock:
            return self._handles.pop(query_id, None)

    def ids(self) -> list[str]:
        with self._lock:
            return list(self._handles)


def build_page_sql(
    handle: ResultHandle,
    *,
    offset: int,
    limit: int,
    sort: str | None,
    descending: bool,
    search: str | None,
) -> tuple[str, str]:
    """Return ``(rows_sql, count_sql)`` for a materialised result."""
    table = handle.qualified_table
    assert table is not None
    names = [column["name"] for column in handle.columns]

    where = ""
    if search:
        needle = quote_literal(f"%{search}%")
        # Cast to VARCHAR so the same free-text filter works on every type.
        clauses = [f"CAST({quote_ident(n)} AS VARCHAR) ILIKE {needle}" for n in names]
        where = f" WHERE {' OR '.join(clauses)}" if clauses else ""

    order = ""
    if sort and sort in names:
        direction = "DESC" if descending else "ASC"
        order = f" ORDER BY {quote_ident(sort)} {direction} NULLS LAST"

    rows_sql = f"SELECT * FROM {table}{where}{order} LIMIT {int(limit)} OFFSET {int(offset)}"
    count_sql = f"SELECT count(*) FROM {table}{where}"
    return rows_sql, count_sql


def slice_memory_rows(
    handle: ResultHandle,
    *,
    offset: int,
    limit: int,
    sort: str | None,
    descending: bool,
    search: str | None,
) -> Page:
    """Paging for the in-Python fallback backing."""
    rows: list[list[Any]] = list(handle.rows or [])
    names = [column["name"] for column in handle.columns]

    if search:
        needle = search.lower()
        rows = [r for r in rows if any(needle in str(c).lower() for c in r if c is not None)]

    if sort and sort in names:
        index = names.index(sort)
        # Nulls are held out and appended, so they land last in both directions
        # just like the ``NULLS LAST`` used on the SQL path.
        present = [r for r in rows if r[index] is not None]
        missing = [r for r in rows if r[index] is None]
        present.sort(key=lambda r: _sort_key(r[index]), reverse=descending)
        rows = present + missing

    total = len(rows)
    return Page(rows=rows[offset : offset + limit], offset=offset, total=total)


def _sort_key(value: Any) -> Any:
    """Comparable key that never raises when a column mixes types."""
    if value is None:
        return ""
    if isinstance(value, (int, float, bool)):
        return value
    return str(value)
