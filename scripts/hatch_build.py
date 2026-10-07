"""Build hook that folds the compiled frontend into the wheel.

Installed users have no ``frontend/`` directory, so the SPA has to travel
inside the package as ``localake/web/``.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

from hatchling.builders.hooks.plugin.interface import BuildHookInterface

FRONTEND = Path("frontend")
DIST = FRONTEND / "dist"
TARGET = "localake/web"


class CustomBuildHook(BuildHookInterface):
    """Ensures ``frontend/dist`` exists, then maps it into the wheel."""

    def initialize(self, version: str, build_data: dict[str, Any]) -> None:
        if version == "editable":
            # A development install runs the app straight from the repository,
            # where the server already falls back to frontend/dist. Requiring a
            # frontend build here would make `uv sync` need Node just to run the
            # backend tests.
            return

        root = Path(self.root)
        dist = root / DIST

        if not (dist / "index.html").is_file():
            self._build_frontend(root)

        if not (dist / "index.html").is_file():
            raise RuntimeError(
                f"no frontend build at {dist}. Run `npm install && npm run build` "
                "in frontend/ before building the package."
            )

        # force_include maps a source path to its location inside the wheel,
        # so nothing has to be copied into the source tree.
        for path in dist.rglob("*"):
            if path.is_file():
                relative = path.relative_to(dist).as_posix()
                build_data["force_include"][str(path)] = f"{TARGET}/{relative}"

    def _build_frontend(self, root: Path) -> None:
        npm = shutil.which("npm")
        if npm is None:
            raise RuntimeError(
                "frontend/dist is missing and npm is not on PATH. Install Node, "
                "or build the frontend yourself before packaging."
            )
        print("building frontend...", file=sys.stderr)
        directory = root / FRONTEND
        if not (directory / "node_modules").is_dir():
            subprocess.run([npm, "install"], cwd=directory, check=True)
        subprocess.run([npm, "run", "build"], cwd=directory, check=True)
