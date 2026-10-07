"""Saved charts: a name, a chart spec, and the SQL that feeds it."""

from __future__ import annotations

import time
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from ..query import QueryFailed
from ..state import Workspace
from .deps import get_workspace

router = APIRouter()

#: Rows a gallery chart renders. Charts summarise; they do not need everything.
CHART_ROW_LIMIT = 5000

ChartType = str


class ChartBody(BaseModel):
    id: str | None = None
    name: str = Field(min_length=1, max_length=120)
    sql: str = Field(min_length=1)
    type: ChartType = Field(default="line", pattern="^(line|bar|area|scatter)$")
    x: str = Field(min_length=1)
    y: list[str] = Field(min_length=1, max_length=8)
    description: str | None = None


@router.get("/charts")
def list_charts(workspace: Workspace = Depends(get_workspace)) -> dict[str, Any]:
    return {"charts": workspace.charts.all()}


@router.post("/charts")
def save_chart(body: ChartBody, workspace: Workspace = Depends(get_workspace)) -> dict[str, Any]:
    now = time.time()
    existing = workspace.charts.get(body.id) if body.id else None
    record = {
        "id": body.id or uuid.uuid4().hex,
        "name": body.name,
        "sql": body.sql,
        "type": body.type,
        "x": body.x,
        "y": body.y,
        "description": body.description,
        "createdAt": (existing or {}).get("createdAt", now),
        "updatedAt": now,
    }
    return workspace.charts.put(record)


@router.delete("/charts/{chart_id}")
def delete_chart(chart_id: str, workspace: Workspace = Depends(get_workspace)) -> dict[str, Any]:
    if not workspace.charts.delete(chart_id):
        raise HTTPException(status_code=404, detail="Unknown chart")
    return {"id": chart_id, "deleted": True}


@router.get("/charts/{chart_id}/data")
def chart_data(
    chart_id: str,
    limit: int = Query(default=CHART_ROW_LIMIT, ge=1, le=CHART_ROW_LIMIT),
    workspace: Workspace = Depends(get_workspace),
) -> dict[str, Any]:
    """Re-run a saved chart's query so the gallery shows current data."""
    chart = workspace.charts.get(chart_id)
    if chart is None:
        raise HTTPException(status_code=404, detail="Unknown chart")
    statement = str(chart["sql"]).strip().rstrip(";")
    try:
        rows, columns = workspace.engine.sql(
            f"SELECT * FROM ({statement}) AS _localake_chart LIMIT {int(limit)}"
        )
    except QueryFailed as exc:
        # The underlying table may have been renamed or deleted since saving.
        raise HTTPException(status_code=422, detail=exc.message) from exc
    return {"chart": chart, "columns": columns, "rows": rows}
