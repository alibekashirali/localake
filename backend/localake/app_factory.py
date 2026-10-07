"""Import target for ``uvicorn --reload``, configured through the environment."""

from __future__ import annotations

import os
from pathlib import Path

from .app import create_app

_project = os.environ.get("LOCALAKE_PROJECT") or str(Path.cwd())
app = create_app(
    _project,
    watch=os.environ.get("LOCALAKE_WATCH", "1") == "1",
    remote=os.environ.get("LOCALAKE_REMOTE", "0") == "1",
)
