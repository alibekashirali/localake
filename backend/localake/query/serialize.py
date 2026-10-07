"""Convert DuckDB values and type names into JSON-friendly shapes."""

from __future__ import annotations

import base64
import datetime as dt
import uuid
from decimal import Decimal
from typing import Any

NUMERIC_PREFIXES = (
    "TINYINT", "SMALLINT", "INTEGER", "BIGINT", "HUGEINT", "UTINYINT", "USMALLINT",
    "UINTEGER", "UBIGINT", "UHUGEINT", "FLOAT", "DOUBLE", "DECIMAL", "REAL", "NUMERIC",
)
TEMPORAL_PREFIXES = ("DATE", "TIME", "TIMESTAMP", "INTERVAL")
STRING_PREFIXES = ("VARCHAR", "CHAR", "TEXT", "STRING", "UUID", "ENUM", "BIT")
COMPLEX_PREFIXES = ("STRUCT", "LIST", "MAP", "UNION", "ARRAY", "[]")

#: Blobs are never useful in a grid; show a short marker instead of megabytes.
BLOB_PREVIEW_BYTES = 24


def classify(type_name: str) -> str:
    """Coarse category driving column icons and alignment in the results grid."""
    upper = str(type_name).upper()
    if upper.startswith("BOOLEAN"):
        return "boolean"
    if any(upper.startswith(p) for p in NUMERIC_PREFIXES):
        return "number"
    if any(upper.startswith(p) for p in TEMPORAL_PREFIXES):
        return "temporal"
    if upper.startswith("BLOB") or upper.startswith("BYTEA"):
        return "binary"
    if any(p in upper for p in COMPLEX_PREFIXES):
        return "complex"
    if any(upper.startswith(p) for p in STRING_PREFIXES):
        return "string"
    return "other"


def to_jsonable(value: Any) -> Any:
    """Coerce a DuckDB cell into something ``orjson`` can emit."""
    if value is None or isinstance(value, (bool, int, str)):
        return value
    if isinstance(value, float):
        # JSON has no NaN/Infinity; null keeps the grid and charts well-formed.
        return value if value == value and abs(value) != float("inf") else None
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (dt.datetime, dt.date, dt.time)):
        return value.isoformat()
    if isinstance(value, dt.timedelta):
        return str(value)
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, (bytes, bytearray, memoryview)):
        raw = bytes(value)
        encoded = base64.b64encode(raw[:BLOB_PREVIEW_BYTES]).decode()
        return f"blob:{len(raw)}B:{encoded}"
    if isinstance(value, (list, tuple, set)):
        return [to_jsonable(item) for item in value]
    if isinstance(value, dict):
        return {str(k): to_jsonable(v) for k, v in value.items()}
    return str(value)


def columns_from_description(description: Any) -> list[dict[str, str]]:
    """Build the column metadata the frontend grid needs from a cursor."""
    if not description:
        return []
    return [
        {"name": col[0], "type": str(col[1]), "category": classify(col[1])}
        for col in description
    ]


def rows_to_jsonable(rows: list[tuple]) -> list[list[Any]]:
    return [[to_jsonable(cell) for cell in row] for row in rows]
