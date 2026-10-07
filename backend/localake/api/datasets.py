"""Dataset endpoints: listing, schema, stats and preview."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from ..catalog.catalog import DatasetNotFound
from ..config import PREVIEW_LIMIT
from ..query import QueryFailed
from ..state import Workspace
from .deps import get_workspace

router = APIRouter()


def _lookup(workspace: Workspace, dataset_id: str, *, readable: bool = False):
    try:
        dataset = workspace.catalog.get(dataset_id)
    except DatasetNotFound as exc:
        raise HTTPException(status_code=404, detail=f"Unknown dataset: {dataset_id}") from exc
    if readable:
        try:
            workspace.catalog.require_readable(dataset)
        except QueryFailed as exc:
            raise HTTPException(status_code=422, detail=exc.message) from exc
    return dataset


@router.get("/datasets")
def list_datasets(
    stats: bool = Query(default=False, description="include row/column counts"),
    workspace: Workspace = Depends(get_workspace),
) -> dict[str, Any]:
    records = []
    for dataset in workspace.catalog.datasets.values():
        record = dataset.to_dict()
        if stats:
            record["stats"] = workspace.catalog.quick_stats(dataset)
        records.append(record)
    return {"datasets": records, "version": workspace.catalog.version}


@router.get("/datasets/{dataset_id:path}/schema")
def dataset_schema(dataset_id: str, workspace: Workspace = Depends(get_workspace)) -> dict[str, Any]:
    dataset = _lookup(workspace, dataset_id, readable=True)
    try:
        columns = workspace.catalog.schema(dataset)
    except QueryFailed as exc:
        raise HTTPException(status_code=422, detail=exc.message) from exc
    return {"dataset": dataset.to_dict(), "columns": columns}


@router.get("/datasets/{dataset_id:path}/profile")
def dataset_profile(dataset_id: str, workspace: Workspace = Depends(get_workspace)) -> dict[str, Any]:
    dataset = _lookup(workspace, dataset_id, readable=True)
    try:
        return workspace.catalog.profile(dataset)
    except QueryFailed as exc:
        raise HTTPException(status_code=422, detail=exc.message) from exc


@router.get("/datasets/{dataset_id:path}/distribution")
def dataset_distribution(
    dataset_id: str,
    column: str = Query(min_length=1, max_length=200),
    workspace: Workspace = Depends(get_workspace),
) -> dict[str, Any]:
    dataset = _lookup(workspace, dataset_id, readable=True)
    try:
        return workspace.catalog.distribution(dataset, column)
    except QueryFailed as exc:
        raise HTTPException(status_code=422, detail=exc.message) from exc


@router.get("/datasets/{dataset_id:path}/preview")
def dataset_preview(
    dataset_id: str,
    limit: int = Query(default=PREVIEW_LIMIT, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    workspace: Workspace = Depends(get_workspace),
) -> dict[str, Any]:
    dataset = _lookup(workspace, dataset_id, readable=True)
    try:
        return workspace.catalog.preview(dataset, limit=limit, offset=offset)
    except QueryFailed as exc:
        raise HTTPException(status_code=422, detail=exc.message) from exc


@router.get("/datasets/{dataset_id:path}")
def dataset_detail(dataset_id: str, workspace: Workspace = Depends(get_workspace)) -> dict[str, Any]:
    dataset = _lookup(workspace, dataset_id)
    payload = dataset.to_dict()
    payload["stats"] = workspace.catalog.stats(dataset)
    return payload


@router.get("/completions")
def completions(workspace: Workspace = Depends(get_workspace)) -> dict[str, Any]:
    """Table and column names for the SQL editor's autocomplete."""
    return workspace.catalog.completions()
