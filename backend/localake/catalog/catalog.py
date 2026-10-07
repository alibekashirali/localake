"""The project catalog: the explorer tree, dataset metadata, and previews."""

from __future__ import annotations

import threading
from typing import Any

import duckdb

from ..config import PREVIEW_LIMIT
from ..project import Project
from ..query.engine import Engine, QueryFailed
from ..query.results import quote_ident, quote_literal
from ..query.serialize import classify, columns_from_description, rows_to_jsonable
from .scanner import Scanner
from .types import Dataset, Node


class DatasetNotFound(Exception):
    pass


class Catalog:
    """Filesystem scan plus the DuckDB views that make the scan queryable."""

    def __init__(self, project: Project, engine: Engine) -> None:
        self.project = project
        self.engine = engine
        self._lock = threading.Lock()
        self._tree = Node(id="", name=project.name, kind="folder", path="")
        self._datasets: dict[str, Dataset] = {}
        self._stats_cache: dict[str, dict[str, Any]] = {}
        self.version = 0

    @property
    def tree(self) -> Node:
        return self._tree

    @property
    def datasets(self) -> dict[str, Dataset]:
        return self._datasets

    def refresh(self) -> Node:
        """Rescan the project directory and re-register every dataset view."""
        with self._lock:
            tree, datasets = Scanner(self.project).scan()
            self.engine.register_datasets(datasets)
            _stamp_errors(tree, datasets)
            self._tree = tree
            self._datasets = datasets
            # File contents may have changed under us; stats have to be re-derived.
            self._stats_cache.clear()
            self.version += 1
            return tree

    def get(self, dataset_id: str) -> Dataset:
        dataset = self._datasets.get(dataset_id)
        if dataset is None:
            raise DatasetNotFound(dataset_id)
        return dataset

    @staticmethod
    def require_readable(dataset: Dataset) -> None:
        """Fail with the real reason a file could not be read.

        Without this the view is simply missing and DuckDB reports a confusing
        "table does not exist" instead of "no magic bytes at end of file".
        """
        if dataset.error:
            raise QueryFailed(dataset.error)

    # -- schema ------------------------------------------------------------

    def schema(self, dataset: Dataset) -> list[dict[str, Any]]:
        """Column list with types and null rates, avoiding a full scan on Parquet."""
        cursor = self.engine.cursor()
        try:
            described = cursor.execute(f"DESCRIBE SELECT * FROM {dataset.qualified_name}").fetchall()
        except duckdb.Error as exc:
            raise QueryFailed(str(exc).splitlines()[0]) from exc

        columns = [
            {"name": row[0], "type": str(row[1]), "category": classify(row[1]), "nullRate": None}
            for row in described
        ]
        null_rates = self._null_rates(dataset, [c["name"] for c in columns])
        for column in columns:
            column["nullRate"] = null_rates.get(column["name"])
        return columns

    def _null_rates(self, dataset: Dataset, names: list[str]) -> dict[str, float]:
        if dataset.format == "parquet":
            rates = self._parquet_null_rates(dataset)
            if rates:
                # Hive partition keys have no Parquet statistics and are never null.
                return {name: rates.get(name, 0.0) for name in names}
        return self._scanned_null_rates(dataset, names)

    def _parquet_null_rates(self, dataset: Dataset) -> dict[str, float]:
        """Read null counts straight out of the Parquet footer — no data pages."""
        cursor = self.engine.cursor()
        try:
            rows = cursor.execute(
                "SELECT path_in_schema, sum(stats_null_count), sum(num_values) "
                f"FROM parquet_metadata({quote_literal(self._parquet_glob(dataset))}) "
                "GROUP BY 1"
            ).fetchall()
        except duckdb.Error:
            return {}
        rates: dict[str, float] = {}
        for name, nulls, values in rows:
            if not values:
                continue
            # Nested columns appear as ``parent.child``; the top level is enough.
            rates[str(name).split(".")[0]] = float(nulls or 0) / float(values) * 100.0
        return rates

    def _scanned_null_rates(self, dataset: Dataset, names: list[str]) -> dict[str, float]:
        if not names:
            return {}
        # One pass computes every column's non-null count at once.
        projections = ", ".join(f"count({quote_ident(n)})" for n in names)
        cursor = self.engine.cursor()
        try:
            row = cursor.execute(
                f"SELECT count(*), {projections} FROM {dataset.qualified_name}"
            ).fetchone()
        except duckdb.Error:
            return {}
        total = row[0] or 0
        if total == 0:
            return {name: 0.0 for name in names}
        return {
            name: (total - (row[index + 1] or 0)) / total * 100.0
            for index, name in enumerate(names)
        }

    def _parquet_glob(self, dataset: Dataset) -> str:
        if dataset.partitioned:
            return f"{dataset.abs_path}/**/*.parquet"
        return dataset.abs_path

    # -- stats & preview ---------------------------------------------------

    def stats(self, dataset: Dataset) -> dict[str, Any]:
        """Row/column counts and size. Cached because the footer read is cheap
        but the CSV fallback is not."""
        cached = self._stats_cache.get(dataset.id)
        if cached is not None:
            return cached

        cursor = self.engine.cursor()
        rows: int | None = None
        if dataset.format == "parquet":
            try:
                rows = cursor.execute(
                    "SELECT sum(num_rows)::BIGINT FROM "
                    f"parquet_file_metadata({quote_literal(self._parquet_glob(dataset))})"
                ).fetchone()[0]
            except duckdb.Error:
                rows = None
        if rows is None:
            try:
                rows = cursor.execute(
                    f"SELECT count(*) FROM {dataset.qualified_name}"
                ).fetchone()[0]
            except duckdb.Error:
                rows = 0

        try:
            column_count = len(
                cursor.execute(f"SELECT * FROM {dataset.qualified_name} LIMIT 0").description or []
            )
        except duckdb.Error:
            column_count = 0

        stats = {
            "rows": int(rows or 0),
            "columns": column_count,
            "sizeBytes": dataset.size_bytes,
        }
        self._stats_cache[dataset.id] = stats
        return stats

    #: Above this many rows the exact duplicate check is skipped: it needs a
    #: full DISTINCT pass, which is not worth stalling the Profile tab for.
    DUPLICATE_ROW_CEILING = 2_000_000

    def profile(self, dataset: Dataset) -> dict[str, Any]:
        """Headline stats plus DuckDB's own per-column summary."""
        stats = self.stats(dataset)
        cursor = self.engine.cursor()

        columns: list[dict[str, Any]] = []
        try:
            rows = cursor.execute(f"SUMMARIZE {dataset.qualified_name}").fetchall()
            names = [description[0] for description in cursor.description or []]
        except duckdb.Error as exc:
            raise QueryFailed(str(exc).splitlines()[0]) from exc

        for row in rows:
            record = dict(zip(names, rows_to_jsonable([row])[0]))
            columns.append(
                {
                    "name": record.get("column_name"),
                    "type": record.get("column_type"),
                    "category": classify(record.get("column_type") or ""),
                    "min": record.get("min"),
                    "max": record.get("max"),
                    "avg": _as_number(record.get("avg")),
                    "median": _as_number(record.get("q50")),
                    "q25": _as_number(record.get("q25")),
                    "q75": _as_number(record.get("q75")),
                    "std": _as_number(record.get("std")),
                    "approxUnique": record.get("approx_unique"),
                    "nullRate": record.get("null_percentage"),
                }
            )

        null_rates = [c["nullRate"] for c in columns if c["nullRate"] is not None]
        total_rows = stats["rows"]
        unique_share = [
            (c["approxUnique"] / total_rows) * 100.0
            for c in columns
            if c["approxUnique"] and total_rows
        ]

        return {
            "dataset": dataset.to_dict(),
            "stats": stats,
            "nullRate": sum(null_rates) / len(null_rates) if null_rates else 0.0,
            "duplicateRate": self._duplicate_rate(dataset, total_rows),
            "uniqueShare": max(unique_share) if unique_share else None,
            "columns": columns,
        }

    def _duplicate_rate(self, dataset: Dataset, total_rows: int) -> float | None:
        if not total_rows or total_rows > self.DUPLICATE_ROW_CEILING:
            return None
        cursor = self.engine.cursor()
        try:
            distinct = cursor.execute(
                f"SELECT count(*) FROM (SELECT DISTINCT * FROM {dataset.qualified_name})"
            ).fetchone()[0]
        except duckdb.Error:
            return None  # nested or unhashable column types
        return max(0.0, (total_rows - distinct) / total_rows * 100.0)

    def quick_stats(self, dataset: Dataset) -> dict[str, Any]:
        """Stats that cost nothing: no table scan, no CSV sniffing beyond a header.

        Parquet row counts come from the footer. Other formats report ``None``
        rather than triggering a full count for every row of a catalog listing.
        """
        cursor = self.engine.cursor()
        rows: int | None = None
        if dataset.format == "parquet" and not dataset.error:
            try:
                rows = cursor.execute(
                    "SELECT sum(num_rows)::BIGINT FROM "
                    f"parquet_file_metadata({quote_literal(self._parquet_glob(dataset))})"
                ).fetchone()[0]
            except duckdb.Error:
                rows = None

        columns: int | None = None
        if not dataset.error:
            try:
                columns = len(
                    cursor.execute(
                        f"SELECT * FROM {dataset.qualified_name} LIMIT 0"
                    ).description or []
                )
            except duckdb.Error:
                columns = None

        return {
            "rows": int(rows) if rows is not None else None,
            "columns": columns,
            "sizeBytes": dataset.size_bytes,
        }

    #: Bars in a numeric histogram, and rows in a top-values list.
    DISTRIBUTION_BINS = 12
    TOP_VALUES = 10

    def distribution(self, dataset: Dataset, column: str) -> dict[str, Any]:
        """How one column's values are spread.

        Numeric and temporal columns get an equi-width histogram; everything
        else gets its most common values, which is what actually helps for
        statuses, countries and identifiers.
        """
        columns = {c["name"]: c for c in self.schema(dataset)}
        if column not in columns:
            raise QueryFailed(f'Column "{column}" is not in this dataset')

        category = columns[column]["category"]
        quoted = quote_ident(column)
        source = dataset.qualified_name
        cursor = self.engine.cursor()

        if category in {"number", "temporal"}:
            bins = self._histogram(cursor, source, quoted, category)
            if bins is not None:
                return {"column": column, "kind": "histogram", "bins": bins}

        try:
            rows = cursor.execute(
                f"SELECT {quoted} AS value, count(*) AS n FROM {source} "
                f"GROUP BY 1 ORDER BY n DESC, 1 LIMIT {self.TOP_VALUES}"
            ).fetchall()
        except duckdb.Error as exc:
            raise QueryFailed(str(exc).splitlines()[0]) from exc
        return {
            "column": column,
            "kind": "topValues",
            "values": [
                {"value": rows_to_jsonable([row])[0][0], "count": int(row[1])} for row in rows
            ],
        }

    def _histogram(
        self, cursor: Any, source: str, quoted: str, category: str
    ) -> list[dict[str, Any]] | None:
        numeric = quoted if category == "number" else f"epoch({quoted})"
        try:
            low, high = cursor.execute(
                f"SELECT min({numeric}), max({numeric}) FROM {source} WHERE {quoted} IS NOT NULL"
            ).fetchone()
        except duckdb.Error:
            return None
        if low is None or high is None:
            return None

        low, high = float(low), float(high)
        if high <= low:
            # A single distinct value has no spread worth drawing.
            return None

        count = self.DISTRIBUTION_BINS
        width = (high - low) / count
        try:
            rows = cursor.execute(
                # floor, not CAST: DuckDB's CAST to INTEGER rounds to nearest,
                # which would shift every bin boundary by half a bin.
                f"SELECT least(CAST(floor(({numeric} - {low}) / {width}) AS INTEGER), {count - 1}) AS bin, "
                f"count(*) AS n FROM {source} WHERE {quoted} IS NOT NULL GROUP BY 1 ORDER BY 1"
            ).fetchall()
        except duckdb.Error:
            return None

        counts = {int(index): int(n) for index, n in rows}
        return [
            {
                "from": low + index * width,
                "to": low + (index + 1) * width,
                "count": counts.get(index, 0),
                "temporal": category == "temporal",
            }
            for index in range(count)
        ]

    def preview(
        self, dataset: Dataset, *, limit: int = PREVIEW_LIMIT, offset: int = 0
    ) -> dict[str, Any]:
        """First N rows. Never reads more than it shows."""
        limit = max(1, min(limit, 1000))
        cursor = self.engine.cursor()
        statement = (
            f"SELECT * FROM {dataset.qualified_name} LIMIT {int(limit)} OFFSET {int(max(0, offset))}"
        )
        try:
            cursor.execute(statement)
        except duckdb.Error as exc:
            raise QueryFailed(str(exc).splitlines()[0]) from exc
        return {
            "columns": columns_from_description(cursor.description),
            "rows": rows_to_jsonable(cursor.fetchall()),
            "offset": offset,
        }

    # -- editor support ----------------------------------------------------

    def completions(self) -> dict[str, Any]:
        """Table and column names for Monaco's autocomplete provider."""
        tables: list[dict[str, Any]] = []
        cursor = self.engine.cursor()
        for dataset in self._datasets.values():
            if dataset.error:
                continue
            try:
                described = cursor.execute(
                    f"SELECT * FROM {dataset.qualified_name} LIMIT 0"
                ).description or []
            except duckdb.Error:
                continue
            tables.append(
                {
                    "schema": dataset.schema_name,
                    "name": dataset.table_name,
                    "qualifiedName": dataset.display_name,
                    "datasetId": dataset.id,
                    "format": dataset.format,
                    "columns": [
                        {"name": col[0], "type": str(col[1])} for col in described
                    ],
                }
            )
        tables.sort(key=lambda t: t["qualifiedName"])
        return {"tables": tables, "version": self.version}


def _as_number(value: Any) -> float | None:
    """SUMMARIZE returns aggregates as strings; the UI wants real numbers."""
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _stamp_errors(node: Node, datasets: dict[str, Dataset]) -> None:
    """Copy per-dataset read errors onto the matching tree nodes."""
    if node.kind == "dataset" and node.dataset_id:
        dataset = datasets.get(node.dataset_id)
        node.error = dataset.error if dataset else None
    for child in node.children:
        _stamp_errors(child, datasets)
