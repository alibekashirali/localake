"""Engine and workspace settings, persisted per project."""

from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..config import DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT
from ..query import QueryFailed
from ..state import Workspace
from .deps import get_workspace

router = APIRouter()

#: DuckDB accepts "4GB", "512MB", "80%" and similar.
MEMORY_PATTERN = re.compile(r"^\d+(\.\d+)?\s*(%|[KMGT]?i?B)$", re.IGNORECASE)

ENGINE_KEYS = ("memory_limit", "threads", "temp_directory", "enable_external_access")


class SettingsBody(BaseModel):
    memoryLimit: str | None = Field(default=None, max_length=32)
    threads: int | None = Field(default=None, ge=1, le=256)
    defaultRowLimit: int | None = Field(default=None, ge=1, le=MAX_QUERY_LIMIT)
    externalAccess: bool | None = None
    watchFiles: bool | None = None


def _engine_settings(workspace: Workspace) -> dict[str, Any]:
    names = ", ".join(f"'{key}'" for key in ENGINE_KEYS)
    rows, _ = workspace.engine.sql(
        f"SELECT name, value FROM duckdb_settings() WHERE name IN ({names})"
    )
    return {name: value for name, value in rows}


@router.get("/settings")
def read_settings(workspace: Workspace = Depends(get_workspace)) -> dict[str, Any]:
    import duckdb

    engine = _engine_settings(workspace)
    stored = workspace.settings.all()
    return {
        "engine": {
            "memoryLimit": engine.get("memory_limit"),
            "threads": int(engine.get("threads") or 0),
            "tempDirectory": engine.get("temp_directory"),
            # Report the live engine state: DuckDB can only tighten external
            # access in-process, so this is the source of truth. The value comes
            # back as a VARCHAR 'true'/'false'.
            "externalAccess": engine.get("enable_external_access") != "false",
        },
        "workspace": {
            "defaultRowLimit": stored.get("defaultRowLimit", DEFAULT_QUERY_LIMIT),
            "watchFiles": stored.get("watchFiles", True),
        },
        "about": {
            "localake": __import__("localake").__version__,
            "duckdb": duckdb.__version__,
            "project": str(workspace.project.root),
            "metadata": str(workspace.project.meta_dir),
            "datasets": len(workspace.catalog.datasets),
        },
    }


@router.put("/settings")
def write_settings(
    body: SettingsBody, workspace: Workspace = Depends(get_workspace)
) -> dict[str, Any]:
    if body.memoryLimit is not None:
        if not MEMORY_PATTERN.match(body.memoryLimit.strip()):
            raise HTTPException(
                status_code=422,
                detail="Memory limit looks like '4GB', '512MB' or '80%'",
            )
        _apply(workspace, "memory_limit", f"'{body.memoryLimit.strip()}'")

    if body.threads is not None:
        _apply(workspace, "threads", str(body.threads))

    if body.externalAccess is not None:
        # Turning this off stops the SQL editor reading files outside the
        # project while still allowing the catalog to re-read project files.
        # DuckDB only allows tightening it, never loosening, within a process —
        # so switching it back on needs a restart.
        if not body.externalAccess:
            workspace.engine.lock_external_access(workspace.project.root)
        workspace.settings.set("externalAccess", body.externalAccess)

    for key, value in (
        ("defaultRowLimit", body.defaultRowLimit),
        ("watchFiles", body.watchFiles),
    ):
        if value is not None:
            workspace.settings.set(key, value)

    return read_settings(workspace)


def _apply(workspace: Workspace, name: str, literal: str) -> None:
    try:
        workspace.engine.sql(f"SET {name} = {literal}")
    except QueryFailed as exc:
        raise HTTPException(status_code=422, detail=f"{name}: {exc.message}") from exc
