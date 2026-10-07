"""FastAPI application factory."""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .api import api_router, ws_router
from .api.deps import ORJSONResponse
from .state import Workspace
from .watcher import watch_project

log = logging.getLogger(__name__)

#: The Vite dev server runs on its own origin; the packaged app is same-origin.
DEV_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]


def find_frontend() -> Path | None:
    """The built SPA: bundled in the wheel, or the dev build in the repo."""
    packaged = Path(__file__).resolve().parent / "web"
    if (packaged / "index.html").is_file():
        return packaged
    repo = Path(__file__).resolve().parents[2] / "frontend" / "dist"
    if (repo / "index.html").is_file():
        return repo
    return None


def create_app(project_path: str | Path, *, watch: bool = True, remote: bool = False) -> FastAPI:
    @asynccontextmanager
    async def lifespan(application: FastAPI):
        workspace = Workspace.open(project_path)
        application.state.workspace = workspace
        # The file watcher lives on app.state so a project switch can cancel it
        # and start a fresh one for the new project.
        application.state.watch_enabled = watch
        application.state.watcher = (
            asyncio.create_task(watch_project(workspace)) if watch else None
        )
        application.state.remote = remote
        log.info(
            "opened %s (%d datasets)", workspace.project.root, len(workspace.catalog.datasets)
        )
        try:
            yield
        finally:
            watcher = getattr(application.state, "watcher", None)
            if watcher is not None:
                watcher.cancel()
            getattr(application.state, "workspace", workspace).close()

    app = FastAPI(
        title="Localake",
        version="0.1.0",
        default_response_class=ORJSONResponse,
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=DEV_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(api_router)
    app.include_router(ws_router)

    @app.get("/api/health")
    def health() -> dict[str, object]:
        workspace: Workspace | None = getattr(app.state, "workspace", None)
        return {
            "status": "ok",
            "mode": "remote" if getattr(app.state, "remote", False) else "local",
            "project": workspace.project.name if workspace else None,
            "clients": workspace.hub.client_count if workspace else 0,
        }

    _mount_frontend(app)
    return app


def _mount_frontend(app: FastAPI) -> None:
    """Serve the built SPA, falling back to index.html for client routes."""
    dist = find_frontend()
    if dist is None:
        log.warning("no frontend build found; serving the API only")

        @app.get("/")
        def missing_build() -> dict[str, str]:
            return {
                "error": "Frontend build not found",
                "hint": "Run `npm install && npm run build` in frontend/, "
                "or `npm run dev` for the dev server on :5173.",
            }

        return

    assets = dist / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    index = dist / "index.html"

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str) -> FileResponse:
        # Any unknown path is a client-side route, so it gets index.html.
        candidate = (dist / full_path).resolve()
        if full_path and dist in candidate.parents and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(index)
