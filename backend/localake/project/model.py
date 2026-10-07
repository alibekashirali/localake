"""Project = a directory on disk plus a ``lakehouse.toml`` describing it."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import tomlkit

LAKEHOUSE_FILE = "lakehouse.toml"
META_DIR = ".localake"

#: Data folders created for a fresh project. Saved queries and charts are not
#: here — they live as metadata under ``.localake/``, so scaffolding empty
#: ``queries/`` and ``charts/`` folders would only clutter the explorer.
SCAFFOLD_DIRS = ("raw", "analytics", "external")


class ProjectError(Exception):
    """Raised when a project directory cannot be opened or created."""


@dataclass(frozen=True)
class Project:
    root: Path
    name: str
    data_root: Path
    engine: str

    @property
    def meta_dir(self) -> Path:
        return self.root / META_DIR

    @property
    def config_path(self) -> Path:
        return self.root / LAKEHOUSE_FILE

    def relative(self, path: Path) -> str:
        """Path relative to the project root, for stable ids across machines."""
        try:
            return path.resolve().relative_to(self.root).as_posix()
        except ValueError:
            return path.resolve().as_posix()

    def resolve(self, relative_path: str) -> Path:
        """Resolve a project-relative path, refusing anything outside the root."""
        candidate = (self.root / relative_path).resolve()
        if candidate != self.root and self.root not in candidate.parents:
            raise ProjectError(f"path escapes the project root: {relative_path}")
        return candidate


def _write_config(path: Path, name: str) -> None:
    doc = tomlkit.document()
    doc.add("name", name)
    data = tomlkit.table()
    data.add("root", "./data")
    doc.add("data", data)
    engine = tomlkit.table()
    engine.add("type", "duckdb")
    doc.add("engine", engine)
    path.write_text(tomlkit.dumps(doc))


def open_project(path: str | Path, *, create: bool = True) -> Project:
    """Open ``path`` as a project, creating ``lakehouse.toml`` if it is missing.

    ``create=False`` makes this strict: the directory must already be a project.
    """
    root = Path(path).expanduser().resolve()
    if not root.exists():
        if not create:
            raise ProjectError(f"no such directory: {root}")
        root.mkdir(parents=True, exist_ok=True)
    if not root.is_dir():
        raise ProjectError(f"not a directory: {root}")

    config_path = root / LAKEHOUSE_FILE
    if not config_path.exists():
        if not create:
            raise ProjectError(f"not a Localake project (no {LAKEHOUSE_FILE}): {root}")
        _write_config(config_path, root.name)
        for directory in SCAFFOLD_DIRS:
            (root / directory).mkdir(exist_ok=True)

    try:
        doc = tomlkit.parse(config_path.read_text())
    except Exception as exc:  # tomlkit raises a family of parse errors
        raise ProjectError(f"could not parse {config_path}: {exc}") from exc

    name = str(doc.get("name") or root.name)
    engine = str((doc.get("engine") or {}).get("type", "duckdb"))

    # ``data.root`` is advisory: when it points at a real subdirectory we scan
    # that, otherwise the project root itself is the data root.
    configured = str((doc.get("data") or {}).get("root", "."))
    data_root = (root / configured).resolve()
    if not data_root.is_dir() or root not in {*data_root.parents, data_root}:
        data_root = root

    project = Project(root=root, name=name, data_root=data_root, engine=engine)
    project.meta_dir.mkdir(exist_ok=True)
    return project
