"""Saved queries and execution history."""

from __future__ import annotations

import time
import uuid
from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from ..state import Workspace
from .deps import get_workspace

router = APIRouter()


class SaveQueryBody(BaseModel):
    id: str | None = None
    name: str = Field(min_length=1, max_length=120)
    sql: str = Field(min_length=1)
    description: str | None = None


@router.get("/queries")
def list_saved(workspace: Workspace = Depends(get_workspace)) -> dict[str, Any]:
    return {"queries": workspace.saved_queries.all()}


@router.post("/queries")
def save_query(body: SaveQueryBody, workspace: Workspace = Depends(get_workspace)) -> dict[str, Any]:
    now = time.time()
    existing = workspace.saved_queries.get(body.id) if body.id else None
    record = {
        "id": body.id or uuid.uuid4().hex,
        "name": body.name,
        "sql": body.sql,
        "description": body.description,
        "createdAt": (existing or {}).get("createdAt", now),
        "updatedAt": now,
    }
    return workspace.saved_queries.put(record)


@router.delete("/queries/{query_id}")
def delete_query(query_id: str, workspace: Workspace = Depends(get_workspace)) -> dict[str, Any]:
    if not workspace.saved_queries.delete(query_id):
        raise HTTPException(status_code=404, detail="Unknown saved query")
    return {"id": query_id, "deleted": True}


@router.get("/history")
def read_history(
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    status: str | None = Query(default=None, pattern="^(completed|failed|cancelled)$"),
    q: str | None = Query(default=None, max_length=200),
    since: str | None = Query(default=None, pattern="^(today|week|month)$"),
    workspace: Workspace = Depends(get_workspace),
) -> dict[str, Any]:
    filtering = bool(status or q or since)
    # Over-fetch when filtering so a page still fills up afterwards.
    entries = workspace.history.recent(limit=limit * 10 if filtering else limit, offset=offset)

    if status:
        entries = [entry for entry in entries if entry.get("status") == status]
    if since:
        entries = [entry for entry in entries if entry.get("startedAt", 0) >= _cutoff(since)]
    if q:
        needle = q.strip().lower()
        entries = [
            entry
            for entry in entries
            if needle in (entry.get("name") or "").lower()
            or needle in (entry.get("sql") or "").lower()
        ]

    return {"entries": entries[:limit]}


def _cutoff(window: str) -> float:
    """Start of the requested window, in local time for "today"."""
    now = datetime.now()
    if window == "today":
        return datetime(now.year, now.month, now.day).timestamp()
    days = 7 if window == "week" else 30
    return (now - timedelta(days=days)).timestamp()


@router.delete("/history")
def clear_history(workspace: Workspace = Depends(get_workspace)) -> dict[str, Any]:
    workspace.history.clear()
    return {"cleared": True}
