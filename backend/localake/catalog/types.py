"""Shared catalog value objects."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

NodeKind = Literal["folder", "dataset", "file"]
DataFormat = Literal["parquet", "csv", "json"]


@dataclass
class Dataset:
    """A file (or directory of parts) exposed as a queryable DuckDB view."""

    id: str
    name: str
    path: str
    abs_path: str
    format: DataFormat
    schema_name: str
    table_name: str
    size_bytes: int
    modified_at: float
    partitioned: bool = False
    error: str | None = None

    @property
    def qualified_name(self) -> str:
        return f'"{self.schema_name}"."{self.table_name}"'

    @property
    def display_name(self) -> str:
        return f"{self.schema_name}.{self.table_name}"

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "path": self.path,
            "format": self.format,
            "schema": self.schema_name,
            "table": self.table_name,
            "qualifiedName": self.display_name,
            "sizeBytes": self.size_bytes,
            "modifiedAt": self.modified_at,
            "partitioned": self.partitioned,
            "error": self.error,
        }


@dataclass
class Node:
    """One row in the Data Explorer tree."""

    id: str
    name: str
    kind: NodeKind
    path: str
    format: DataFormat | None = None
    dataset_id: str | None = None
    size_bytes: int | None = None
    error: str | None = None
    children: list["Node"] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "id": self.id,
            "name": self.name,
            "kind": self.kind,
            "path": self.path,
        }
        if self.format:
            payload["format"] = self.format
        if self.dataset_id:
            payload["datasetId"] = self.dataset_id
        if self.size_bytes is not None:
            payload["sizeBytes"] = self.size_bytes
        if self.error:
            payload["error"] = self.error
        if self.kind == "folder":
            payload["children"] = [child.to_dict() for child in self.children]
        return payload
