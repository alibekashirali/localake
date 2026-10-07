"""Notebooks: ordered SQL cells saved as files in the project."""

from __future__ import annotations

import time
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..config import DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT
from ..query import QueryFailed
from ..state import Workspace
from .deps import get_workspace

router = APIRouter()


class CellBody(BaseModel):
    id: str | None = None
    sql: str = ""


class SaveNotebookBody(BaseModel):
    id: str | None = None
    name: str = Field(min_length=1, max_length=120)
    cells: list[CellBody] = Field(default_factory=list)


class RunCellBody(BaseModel):
    sql: str = Field(min_length=1)
    limit: int = Field(default=DEFAULT_QUERY_LIMIT, ge=1, le=MAX_QUERY_LIMIT)


@router.get("/notebooks")
def list_notebooks(workspace: Workspace = Depends(get_workspace)) -> dict[str, Any]:
    return {"notebooks": workspace.notebooks.all()}


@router.post("/notebooks")
def save_notebook(
    body: SaveNotebookBody, workspace: Workspace = Depends(get_workspace)
) -> dict[str, Any]:
    now = time.time()
    existing = workspace.notebooks.get(body.id) if body.id else None
    record = {
        "id": body.id or uuid.uuid4().hex,
        "name": body.name,
        "cells": [{"id": cell.id or uuid.uuid4().hex, "sql": cell.sql} for cell in body.cells],
        "createdAt": (existing or {}).get("createdAt", now),
        "updatedAt": now,
    }
    return workspace.notebooks.put(record)


@router.delete("/notebooks/{notebook_id}")
def delete_notebook(
    notebook_id: str, workspace: Workspace = Depends(get_workspace)
) -> dict[str, Any]:
    if not workspace.notebooks.delete(notebook_id):
        raise HTTPException(status_code=404, detail="Unknown notebook")
    return {"id": notebook_id, "deleted": True}


@router.post("/notebooks/run")
def run_cell(body: RunCellBody, workspace: Workspace = Depends(get_workspace)) -> dict[str, Any]:
    """Run one cell's SQL against the shared DuckDB session."""
    try:
        return workspace.engine.run_cell(body.sql, body.limit)
    except QueryFailed as exc:
        raise HTTPException(status_code=422, detail=exc.message) from exc
