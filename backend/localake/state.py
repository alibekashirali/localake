"""The workspace: one open project and everything hanging off it."""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from .catalog import Catalog
from .config import AppState
from .events import EventHub
from .project import Project, open_project
from .query import Engine, QueryCancelled, QueryFailed
from .storage import NOTEBOOK_KIND, DocumentStore, HistoryLog, JsonStore, KeyValueStore

log = logging.getLogger(__name__)

#: How often a running query is polled for progress.
PROGRESS_INTERVAL = 0.4

#: Concurrent query slots. DuckDB parallelises within a query, so a handful of
#: simultaneous tabs is plenty and keeps memory predictable.
QUERY_WORKERS = 4


class Workspace:
    def __init__(self, project: Project) -> None:
        self.project = project
        self.engine = Engine(project)
        self.catalog = Catalog(project, self.engine)
        self.hub = EventHub()
        self.saved_queries = JsonStore(project.meta_dir / "queries.json")
        # Charts and notebooks are user-visible files so they can be committed
        # alongside the data they describe.
        self.charts = DocumentStore(project.root / "charts")
        self.notebooks = DocumentStore(project.root / "notebooks", kind=NOTEBOOK_KIND)
        self.history = HistoryLog(project.meta_dir / "history.jsonl")
        self.settings = KeyValueStore(project.meta_dir / "settings.json")
        # A lockdown the user asked for must survive a restart: DuckDB defaults
        # external access back to on for a fresh connection. Applied before the
        # catalog is scanned so the views re-register against allowed_directories.
        if not self.settings.get("externalAccess", True):
            self.engine.lock_external_access(project.root)
        self.started_at = time.time()
        self._executor = ThreadPoolExecutor(
            max_workers=QUERY_WORKERS, thread_name_prefix="localake-query"
        )
        self._runs: dict[str, dict[str, Any]] = {}
        self._tasks: set[asyncio.Task[None]] = set()

    @classmethod
    def open(cls, path: str | Path, *, create: bool = True) -> "Workspace":
        project = open_project(path, create=create)
        workspace = cls(project)
        workspace.catalog.refresh()
        AppState.load().remember(project.root)
        return workspace

    def close(self) -> None:
        for task in list(self._tasks):
            task.cancel()
        self._executor.shutdown(wait=False, cancel_futures=True)
        self.engine.close()

    # -- query lifecycle ---------------------------------------------------

    def submit(self, sql: str, *, query_id: str | None = None, limit: int | None = None,
               tab_id: str | None = None, name: str | None = None) -> str:
        """Start a query and return its id. Results arrive over the event hub."""
        run_id = query_id or uuid.uuid4().hex
        self._runs[run_id] = {
            "queryId": run_id,
            "tabId": tab_id,
            "name": name,
            "sql": sql,
            "status": "running",
            "startedAt": time.time(),
        }
        task = asyncio.create_task(self._run(run_id, sql, limit))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return run_id

    async def _run(self, run_id: str, sql: str, limit: int | None) -> None:
        record = self._runs[run_id]
        await self.hub.publish({"type": "query.running", "queryId": run_id, "tabId": record["tabId"]})
        loop = asyncio.get_running_loop()
        future = loop.run_in_executor(
            self._executor, lambda: self.engine.execute(sql, query_id=run_id, limit=limit)
        )
        reporter = asyncio.create_task(self._report_progress(run_id, record["tabId"], future))
        try:
            handle = await future
        except QueryCancelled:
            record.update(status="cancelled", finishedAt=time.time())
            self._log_history(record, error="Cancelled")
            await self.hub.publish(
                {"type": "query.cancelled", "queryId": run_id, "tabId": record["tabId"]}
            )
            return
        except QueryFailed as exc:
            record.update(status="failed", error=exc.message, finishedAt=time.time())
            self._log_history(record, error=exc.message)
            await self.hub.publish(
                {
                    "type": "query.failed",
                    "queryId": run_id,
                    "tabId": record["tabId"],
                    "error": exc.message,
                }
            )
            return
        except Exception as exc:  # a bug here must not take down the socket
            log.exception("unexpected query failure")
            message = f"Internal error: {exc}"
            record.update(status="failed", error=message, finishedAt=time.time())
            await self.hub.publish(
                {"type": "query.failed", "queryId": run_id, "tabId": record["tabId"], "error": message}
            )
            return
        finally:
            reporter.cancel()

        summary = handle.to_dict()
        record.update(status="completed", finishedAt=time.time(), result=summary)
        self._log_history(record, result=summary)
        await self.hub.publish(
            {
                "type": "query.completed",
                "queryId": run_id,
                "tabId": record["tabId"],
                "result": summary,
            }
        )

    async def _report_progress(
        self, run_id: str, tab_id: str | None, future: "asyncio.Future[Any]"
    ) -> None:
        """Publish progress while a query runs, when DuckDB can estimate it."""
        last = -1.0
        try:
            while not future.done():
                await asyncio.sleep(PROGRESS_INTERVAL)
                percent = self.engine.progress(run_id)
                # Only meaningful movement is worth a frame on the socket.
                if percent is None or abs(percent - last) < 1.0:
                    continue
                last = percent
                await self.hub.publish(
                    {
                        "type": "query.progress",
                        "queryId": run_id,
                        "tabId": tab_id,
                        "percent": round(percent, 1),
                    }
                )
        except asyncio.CancelledError:
            raise

    def _log_history(
        self,
        record: dict[str, Any],
        *,
        result: dict[str, Any] | None = None,
        error: str | None = None,
    ) -> None:
        self.history.append(
            {
                "id": record["queryId"],
                "name": record.get("name"),
                "sql": record["sql"],
                "status": record["status"],
                "startedAt": record["startedAt"],
                "finishedAt": record.get("finishedAt"),
                "elapsedMs": (result or {}).get("elapsedMs"),
                "rowCount": (result or {}).get("rowCount"),
                "error": error,
            }
        )

    def run_state(self, run_id: str) -> dict[str, Any] | None:
        return self._runs.get(run_id)

    def cancel(self, run_id: str) -> bool:
        return self.engine.cancel(run_id)

    def release(self, run_id: str) -> None:
        self.engine.release(run_id)
        self._runs.pop(run_id, None)

    # -- catalog -----------------------------------------------------------

    async def refresh_catalog(self) -> None:
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(self._executor, self.catalog.refresh)
        await self.hub.publish({"type": "catalog.updated", "version": self.catalog.version})
