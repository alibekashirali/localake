"""Lineage: how files, tables, views, queries and charts connect."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from ..catalog.catalog import DatasetNotFound
from ..lineage.graph import build_graph, focus
from ..state import Workspace
from .deps import get_workspace

router = APIRouter()


def _user_views(workspace: Workspace) -> list[dict[str, str]]:
    """Views created from the SQL editor, which the catalog does not own."""
    managed = {d.display_name.lower() for d in workspace.catalog.datasets.values()}
    rows, _ = workspace.engine.sql(
        "SELECT schema_name, view_name, sql FROM duckdb_views() "
        "WHERE NOT internal AND database_name = current_database()"
    )
    return [
        {"schema": str(schema), "name": str(name), "sql": str(sql or "")}
        for schema, name, sql in rows
        if f"{schema}.{name}".lower() not in managed
    ]


def _graph(workspace: Workspace) -> dict[str, Any]:
    return build_graph(
        workspace.catalog.datasets.values(),
        workspace.saved_queries.all(),
        workspace.charts.all(),
        _user_views(workspace),
    )


@router.get("/lineage")
def whole_graph(workspace: Workspace = Depends(get_workspace)) -> dict[str, Any]:
    return _graph(workspace)


@router.get("/lineage/{dataset_id:path}")
def dataset_graph(
    dataset_id: str,
    depth: int = Query(default=2, ge=1, le=6),
    workspace: Workspace = Depends(get_workspace),
) -> dict[str, Any]:
    """The neighbourhood around one dataset, upstream and downstream."""
    try:
        dataset = workspace.catalog.get(dataset_id)
    except DatasetNotFound as exc:
        raise HTTPException(status_code=404, detail=f"Unknown dataset: {dataset_id}") from exc
    return focus(_graph(workspace), f"table:{dataset.display_name}", depth=depth)
