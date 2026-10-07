"""Watch the project directory and refresh the catalog when files change."""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from watchfiles import awatch

from .project import META_DIR
from .state import Workspace

log = logging.getLogger(__name__)

#: Coalesce bursts (a Spark job writing 200 part files) into one rescan.
DEBOUNCE_MS = 700


def _is_relevant(_change: int, path: str) -> bool:
    parts = Path(path).parts
    if META_DIR in parts or ".git" in parts:
        return False
    return not Path(path).name.startswith(".")


async def watch_project(workspace: Workspace) -> None:
    root = workspace.project.data_root
    try:
        async for _ in awatch(root, watch_filter=_is_relevant, debounce=DEBOUNCE_MS, recursive=True):
            # The Settings toggle can turn auto-rescan off without stopping the
            # watcher task; a manual "Rescan project" still works either way.
            if not workspace.settings.get("watchFiles", True):
                continue
            try:
                await workspace.refresh_catalog()
            except Exception:  # a bad file must not kill the watcher
                log.exception("catalog refresh failed after a filesystem change")
    except asyncio.CancelledError:
        raise
    except Exception:
        log.exception("file watcher stopped")
