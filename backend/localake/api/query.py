"""Query submission, cancellation, paging and export."""

from __future__ import annotations

import csv
import io
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..config import DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT
from ..query import QueryFailed
from ..state import Workspace
from .deps import get_workspace

router = APIRouter()

#: Rows read from DuckDB per pass while streaming an export. Chunking keeps a
#: single page in memory instead of the whole result, so an export is bounded
#: only by the query's own row limit — never silently truncated at a fixed cap.
EXPORT_CHUNK = 50_000


class RunBody(BaseModel):
    sql: str = Field(min_length=1)
    queryId: str | None = None
    tabId: str | None = None
    name: str | None = None
    limit: int = Field(default=DEFAULT_QUERY_LIMIT, ge=1, le=MAX_QUERY_LIMIT)


@router.post("/query", status_code=202)
async def run_query(body: RunBody, workspace: Workspace = Depends(get_workspace)) -> dict[str, Any]:
    """Accept a query and return immediately; progress arrives over the socket."""
    if body.queryId:
        workspace.release(body.queryId)  # a re-run replaces the tab's old result
    query_id = workspace.submit(
        body.sql, query_id=body.queryId, limit=body.limit, tab_id=body.tabId, name=body.name
    )
    return {"queryId": query_id, "status": "running"}


@router.post("/query/{query_id}/cancel")
def cancel_query(query_id: str, workspace: Workspace = Depends(get_workspace)) -> dict[str, Any]:
    return {"queryId": query_id, "cancelled": workspace.cancel(query_id)}


@router.get("/query/{query_id}")
def query_state(query_id: str, workspace: Workspace = Depends(get_workspace)) -> dict[str, Any]:
    state = workspace.run_state(query_id)
    if state is None:
        raise HTTPException(status_code=404, detail="Unknown query")
    return {k: v for k, v in state.items() if k != "sql"} | {"sql": state["sql"]}


@router.get("/query/{query_id}/rows")
def query_rows(
    query_id: str,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=5000),
    sort: str | None = None,
    desc: bool = False,
    search: str | None = Query(default=None, max_length=200),
    workspace: Workspace = Depends(get_workspace),
) -> dict[str, Any]:
    try:
        page = workspace.engine.page(
            query_id, offset=offset, limit=limit, sort=sort, descending=desc, search=search
        )
    except QueryFailed as exc:
        raise HTTPException(status_code=422, detail=exc.message) from exc
    if page is None:
        raise HTTPException(status_code=404, detail="Result is no longer available")
    return page.to_dict()


@router.delete("/query/{query_id}")
def release_query(query_id: str, workspace: Workspace = Depends(get_workspace)) -> dict[str, Any]:
    workspace.release(query_id)
    return {"queryId": query_id, "released": True}


@router.get("/query/{query_id}/summary")
def query_summary(query_id: str, workspace: Workspace = Depends(get_workspace)) -> dict[str, Any]:
    """Per-column statistics for the result set, computed by DuckDB's SUMMARIZE."""
    handle = workspace.engine.results.get(query_id)
    if handle is None:
        raise HTTPException(status_code=404, detail="Result is no longer available")
    if handle.table is None:
        raise HTTPException(status_code=422, detail="This result cannot be summarised")
    try:
        rows, columns = workspace.engine.sql(f"SUMMARIZE {handle.qualified_table}")
    except QueryFailed as exc:
        raise HTTPException(status_code=422, detail=exc.message) from exc
    return {"columns": columns, "rows": rows}


@router.get("/query/{query_id}/plan")
def query_plan(query_id: str, workspace: Workspace = Depends(get_workspace)) -> dict[str, Any]:
    state = workspace.run_state(query_id)
    if state is None:
        raise HTTPException(status_code=404, detail="Unknown query")
    try:
        plan = workspace.engine.explain(state["sql"])
    except QueryFailed as exc:
        raise HTTPException(status_code=422, detail=exc.message) from exc

    # Re-running under profiling is the only way to learn what was actually
    # read, so it is best-effort: a plan without counts beats no plan.
    try:
        measured = workspace.engine.analyze(state["sql"])
    except QueryFailed:
        measured = {"rowsScanned": None, "bytesRead": None, "operators": []}

    result = state.get("result") or {}
    return {
        "plan": plan,
        "elapsedMs": result.get("elapsedMs"),
        "rowCount": result.get("rowCount"),
        "statements": result.get("statements"),
        **measured,
    }


@router.get("/query/{query_id}/export")
def export_rows(
    query_id: str,
    format: str = Query(default="csv", pattern="^(csv|json)$"),
    workspace: Workspace = Depends(get_workspace),
) -> StreamingResponse:
    handle = workspace.engine.results.get(query_id)
    if handle is None:
        raise HTTPException(status_code=404, detail="Result is no longer available")
    names = [column["name"] for column in handle.columns]
    total = handle.row_count or 0

    def stream_pages():
        offset = 0
        while offset < total:
            page = workspace.engine.page(query_id, offset=offset, limit=EXPORT_CHUNK)
            if page is None or not page.rows:
                return
            yield from page.rows
            # page() caps the page size, so advance by what actually came back.
            offset += len(page.rows)

    if format == "json":
        import orjson

        def generate():
            yield "["
            first = True
            for row in stream_pages():
                if not first:
                    yield ","
                first = False
                yield orjson.dumps(dict(zip(names, row))).decode("utf-8")
            yield "]"

        media, suffix = "application/json", "json"
    else:

        def generate():
            buffer = io.StringIO()
            writer = csv.writer(buffer)
            writer.writerow(names)
            yield buffer.getvalue()
            buffer = io.StringIO()
            writer = csv.writer(buffer)
            buffered = 0
            for row in stream_pages():
                writer.writerow(row)
                buffered += 1
                if buffered >= 1000:
                    yield buffer.getvalue()
                    buffer = io.StringIO()
                    writer = csv.writer(buffer)
                    buffered = 0
            if buffered:
                yield buffer.getvalue()

        media, suffix = "text/csv", "csv"

    return StreamingResponse(
        generate(),
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="result-{query_id[:8]}.{suffix}"'},
    )
