"""Application-level configuration (independent of any single project)."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path

APP_DIR = Path(os.environ.get("LOCALAKE_HOME", Path.home() / ".localake"))
STATE_FILE = APP_DIR / "state.json"

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 3000

#: Files larger than this are still previewed lazily; used only for display hints.
PREVIEW_LIMIT = 100
#: Default row cap applied to ad-hoc queries from the editor.
DEFAULT_QUERY_LIMIT = 1000
#: Hard ceiling on rows materialised for a single result set.
MAX_QUERY_LIMIT = 1_000_000


@dataclass
class AppState:
    """Small bit of cross-session state: which projects the user has opened."""

    recent_projects: list[str] = field(default_factory=list)
    last_project: str | None = None

    @classmethod
    def load(cls) -> "AppState":
        if not STATE_FILE.exists():
            return cls()
        try:
            raw = json.loads(STATE_FILE.read_text())
        except (OSError, json.JSONDecodeError):
            return cls()
        return cls(
            recent_projects=list(raw.get("recent_projects", [])),
            last_project=raw.get("last_project"),
        )

    def save(self) -> None:
        APP_DIR.mkdir(parents=True, exist_ok=True)
        STATE_FILE.write_text(
            json.dumps(
                {"recent_projects": self.recent_projects, "last_project": self.last_project},
                indent=2,
            )
        )

    def remember(self, path: Path) -> None:
        entry = str(path)
        # Drop entries whose directory has since been deleted or moved, so the
        # project switcher never fills up with dead paths.
        surviving = [p for p in self.recent_projects if p != entry and Path(p).is_dir()]
        self.recent_projects = [entry, *surviving][:10]
        self.last_project = entry
        self.save()
