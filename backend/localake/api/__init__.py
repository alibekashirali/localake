from fastapi import APIRouter

from . import charts, datasets, imports, lineage, notebooks, project, queries, query, settings, ws

api_router = APIRouter(prefix="/api")
api_router.include_router(project.router, tags=["project"])
api_router.include_router(datasets.router, tags=["datasets"])
api_router.include_router(query.router, tags=["query"])
api_router.include_router(queries.router, tags=["queries"])
api_router.include_router(charts.router, tags=["charts"])
api_router.include_router(lineage.router, tags=["lineage"])
api_router.include_router(settings.router, tags=["settings"])
api_router.include_router(imports.router, tags=["imports"])
api_router.include_router(notebooks.router, tags=["notebooks"])

ws_router = ws.router

__all__ = ["api_router", "ws_router"]
