"""Project lifecycle, the explorer tree, and global search."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from ..config import AppState
from ..project.model import ProjectError
from ..state import Workspace
from ..watcher import watch_project
from .deps import get_workspace

router = APIRouter()

#: Cap on results per search category, so the palette stays snappy and readable.
SEARCH_LIMIT = 8


class OpenProjectBody(BaseModel):
    path: str = Field(min_length=1)
    create: bool = True


def _project_payload(workspace: Workspace, *, remote: bool = False) -> dict[str, Any]:
    project = workspace.project
    return {
        "name": project.name,
        "root": str(project.root),
        "displayRoot": _tildify(project.root),
        "dataRoot": str(project.data_root),
        "engine": project.engine,
        "datasetCount": len(workspace.catalog.datasets),
        "catalogVersion": workspace.catalog.version,
        "mode": "remote" if remote else "local",
    }


def _tildify(path: Path) -> str:
    home = Path.home()
    try:
        return f"~/{path.relative_to(home).as_posix()}"
    except ValueError:
        return str(path)


@router.get("/project")
def read_project(request: Request, workspace: Workspace = Depends(get_workspace)) -> dict[str, Any]:
    return _project_payload(workspace, remote=getattr(request.app.state, "remote", False))


@router.get("/project/recent")
def recent_projects() -> dict[str, Any]:
    state = AppState.load()
    return {
        "recent": [
            {"path": path, "name": Path(path).name, "exists": Path(path).is_dir()}
            for path in state.recent_projects
        ]
    }


@router.post("/project")
async def open_project_endpoint(body: OpenProjectBody, request: Request) -> dict[str, Any]:
    """Point the running server at a different project directory."""
    # Opening a project scans the filesystem and builds DuckDB views, so run it
    # off the event loop rather than blocking every request while it works.
    loop = asyncio.get_running_loop()
    try:
        workspace = await loop.run_in_executor(
            None, lambda: Workspace.open(body.path, create=body.create)
        )
    except ProjectError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    previous: Workspace | None = getattr(request.app.state, "workspace", None)
    request.app.state.workspace = workspace

    if previous is not None:
        # Wake connected sockets so they resubscribe to the new hub instead of
        # staying subscribed to the closed workspace's event stream.
        await previous.hub.publish(
            {"type": "workspace.changed", "project": workspace.project.name}
        )

    # Follow the new project with a fresh watcher task; the old one watched the
    # previous project's data root and would never fire again.
    old_watcher = getattr(request.app.state, "watcher", None)
    if old_watcher is not None:
        old_watcher.cancel()
    request.app.state.watcher = (
        asyncio.create_task(watch_project(workspace))
        if getattr(request.app.state, "watch_enabled", True)
        else None
    )

    if previous is not None:
        previous.close()

    return _project_payload(workspace, remote=getattr(request.app.state, "remote", False))


@router.get("/tree")
def read_tree(workspace: Workspace = Depends(get_workspace)) -> dict[str, Any]:
    return {
        "tree": workspace.catalog.tree.to_dict(),
        "version": workspace.catalog.version,
    }


@router.post("/tree/refresh")
async def refresh_tree(workspace: Workspace = Depends(get_workspace)) -> dict[str, Any]:
    await workspace.refresh_catalog()
    return {"tree": workspace.catalog.tree.to_dict(), "version": workspace.catalog.version}


@router.get("/search")
def search(
    q: str = Query(default="", max_length=200),
    workspace: Workspace = Depends(get_workspace),
) -> dict[str, Any]:
    """Global search over tables, columns, saved queries and charts."""
    needle = q.strip().lower()
    if len(needle) < 2:
        return {"query": q, "groups": []}

    tables: list[dict[str, Any]] = []
    columns: list[dict[str, Any]] = []
    for table in workspace.catalog.completions()["tables"]:
        if needle in table["qualifiedName"].lower():
            tables.append(
                {
                    "label": table["qualifiedName"],
                    "sublabel": table["format"],
                    "datasetId": table["datasetId"],
                }
            )
        for column in table["columns"]:
            if needle in column["name"].lower():
                columns.append(
                    {
                        "label": f"{table['qualifiedName']}.{column['name']}",
                        "sublabel": column["type"],
                        "datasetId": table["datasetId"],
                    }
                )

    queries = [
        {
            "label": item.get("name") or "Untitled",
            "sublabel": _snippet(item.get("sql", "")),
            "queryId": item.get("id"),
            # The full SQL travels too, so the palette can open the query in a tab.
            "sql": item.get("sql", ""),
        }
        for item in workspace.saved_queries.all()
        if needle in (item.get("name", "") + " " + item.get("sql", "")).lower()
    ]
    charts = [
        {"label": item.get("name") or "Untitled", "sublabel": item.get("type", "chart"), "chartId": item.get("id")}
        for item in workspace.charts.all()
        if needle in item.get("name", "").lower()
    ]

    files = [
        {"label": node["name"], "sublabel": node["path"], "path": node["path"]}
        for node in _walk_files(workspace.catalog.tree.to_dict())
        if needle in node["name"].lower()
    ]
    projects: list[dict[str, Any]] = []
    for path in AppState.load().recent_projects:
        directory = Path(path)
        if needle in directory.name.lower() and directory.is_dir():
            projects.append(
                {"label": directory.name, "sublabel": path, "projectPath": path}
            )

    groups = [
        {"kind": "tables", "title": "Tables", "items": tables[:SEARCH_LIMIT]},
        {"kind": "columns", "title": "Columns", "items": columns[:SEARCH_LIMIT]},
        {"kind": "queries", "title": "Queries", "items": queries[:SEARCH_LIMIT]},
        {"kind": "charts", "title": "Charts", "items": charts[:SEARCH_LIMIT]},
        {"kind": "files", "title": "Files", "items": files[:SEARCH_LIMIT]},
        {"kind": "projects", "title": "Projects", "items": projects[:SEARCH_LIMIT]},
    ]
    return {"query": q, "groups": [group for group in groups if group["items"]]}


def _walk_files(node: dict[str, Any]) -> list[dict[str, Any]]:
    """Every non-dataset file in the tree — READMEs, configs, notes."""
    found: list[dict[str, Any]] = []
    if node.get("kind") == "file":
        found.append(node)
    for child in node.get("children", []):
        found.extend(_walk_files(child))
    return found


def _snippet(sql: str, length: int = 60) -> str:
    flat = " ".join(sql.split())
    return flat if len(flat) <= length else flat[: length - 1] + "…"
