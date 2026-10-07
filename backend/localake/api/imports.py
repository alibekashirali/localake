"""File upload: point a browser file picker at the project folder.

The filesystem is already the import path — dropping a file into the project
folder and letting the watcher pick it up works fine. This endpoint is the
convenience route for doing that from the UI without leaving the app.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile

from ..project.model import ProjectError
from ..state import Workspace
from .deps import get_workspace

router = APIRouter()

#: Hard ceiling on a single upload. Anything larger belongs on the filesystem
#: directly, where the watcher picks it up without a browser round-trip.
MAX_UPLOAD_BYTES = 10 * 1024**3  # 10 GiB


@router.post("/import")
async def import_file(
    file: UploadFile = File(...),
    target: str = Query(default="raw", max_length=200),
    workspace: Workspace = Depends(get_workspace),
) -> dict[str, Any]:
    """Save an uploaded file into the project, then rescan the catalog."""
    # Strip any directory components the browser sent; a filename must stay a
    # filename. Backslashes are treated as separators too, for Windows clients.
    filename = Path((file.filename or "").replace("\\", "/")).name
    if not filename or filename in {".", ".."}:
        raise HTTPException(status_code=400, detail="The upload needs a filename")

    try:
        destination_dir = workspace.project.resolve(target.strip().strip("/") or "raw")
    except ProjectError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    destination_dir.mkdir(parents=True, exist_ok=True)
    destination = destination_dir / filename

    written = 0
    try:
        with destination.open("wb") as out:
            while chunk := await file.read(1024 * 1024):
                written += len(chunk)
                if written > MAX_UPLOAD_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail="File is too large to upload (over 10 GiB)",
                    )
                out.write(chunk)
    except HTTPException:
        destination.unlink(missing_ok=True)
        raise
    except OSError as exc:
        destination.unlink(missing_ok=True)
        raise HTTPException(
            status_code=500, detail=f"Could not write the file: {exc}"
        ) from exc

    await workspace.refresh_catalog()

    relative = workspace.project.relative(destination)
    dataset = workspace.catalog.datasets.get(relative)
    return {
        "filename": filename,
        "path": relative,
        "sizeBytes": destination.stat().st_size,
        "dataset": dataset.to_dict() if dataset else None,
    }
