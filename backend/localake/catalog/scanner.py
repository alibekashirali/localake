"""Walk a project directory and turn it into a tree of datasets and files."""

from __future__ import annotations

import re
from pathlib import Path

from ..project import META_DIR, Project
from ..storage import is_localake_document
from .types import DataFormat, Dataset, Node

PARQUET_SUFFIXES = {".parquet", ".pq"}
# ``.txt`` is deliberately not here: arbitrary text files (notes, READMEs) are
# not data, and auto-registering them as CSV only produces read errors.
CSV_SUFFIXES = {".csv", ".tsv"}
JSON_SUFFIXES = {".json", ".ndjson", ".jsonl"}

IGNORED_DIRS = {META_DIR, ".git", ".venv", "node_modules", "__pycache__", ".idea", ".vscode"}
IGNORED_FILES = {".DS_Store"}

#: Depth guard so a stray symlink or a deep partition tree cannot hang a scan.
MAX_DEPTH = 12

_IDENT_RE = re.compile(r"[^a-z0-9_]+")


def sanitize_identifier(raw: str) -> str:
    """Turn an arbitrary path fragment into a safe, lowercase SQL identifier."""
    ident = _IDENT_RE.sub("_", raw.strip().lower()).strip("_")
    if not ident:
        ident = "unnamed"
    if ident[0].isdigit():
        ident = f"_{ident}"
    return ident


def detect_format(path: Path) -> DataFormat | None:
    suffix = path.suffix.lower()
    if suffix in PARQUET_SUFFIXES:
        return "parquet"
    if suffix in CSV_SUFFIXES:
        return "csv"
    if suffix in JSON_SUFFIXES:
        return "json"
    return None


def _is_hidden(path: Path) -> bool:
    return path.name.startswith(".") or path.name in IGNORED_FILES


#: Part-file names written by Spark, DuckDB and friends. A directory of these
#: is one dataset; a directory of ``orders.parquet``/``customers.parquet`` is not.
PART_FILE_RE = re.compile(r"^(part[-_]|data[-_]|chunk[-_]|\d+\.)")


def _all_parquet_under(directory: Path) -> list[Path] | None:
    """Every file beneath ``directory``, or ``None`` if any is not Parquet."""
    parts: list[Path] = []
    for child in directory.rglob("*"):
        if child.is_dir():
            if child.name in IGNORED_DIRS:
                return None
            continue
        if _is_hidden(child) or child.name.endswith(".crc") or child.name == "_SUCCESS":
            continue
        if child.suffix.lower() not in PARQUET_SUFFIXES:
            return None
        parts.append(child)
    return parts or None


def partition_parts(directory: Path) -> list[Path] | None:
    """Parts of a single multi-file dataset, or ``None`` for a plain folder.

    Two shapes qualify: a Hive layout (``day=2024-06-01/…``) and a flat
    directory of part files. Anything else — notably a folder holding several
    independently named tables — stays a folder in the tree.
    """
    try:
        children = [c for c in directory.iterdir() if not _is_hidden(c)]
    except (OSError, PermissionError):
        return None
    if not children:
        return None

    directories = [c for c in children if c.is_dir()]
    files = [c for c in children if c.is_file()]

    if directories and all("=" in c.name for c in directories) and not files:
        return _all_parquet_under(directory)

    if not directories and len(files) >= 2:
        if all(
            f.suffix.lower() in PARQUET_SUFFIXES and PART_FILE_RE.match(f.name.lower())
            for f in files
        ):
            return files

    return None


class Scanner:
    """Produces the explorer tree plus the dataset registry for a project."""

    def __init__(self, project: Project) -> None:
        self.project = project
        self.datasets: dict[str, Dataset] = {}
        self._taken: set[tuple[str, str]] = set()

    def scan(self) -> tuple[Node, dict[str, Dataset]]:
        self.datasets = {}
        self._taken = set()
        root = Node(id="", name=self.project.name, kind="folder", path="")
        root.children = self._walk(self.project.data_root, depth=0)
        return root, self.datasets

    # -- internals ---------------------------------------------------------

    def _walk(self, directory: Path, depth: int) -> list[Node]:
        if depth >= MAX_DEPTH:
            return []
        folders: list[Node] = []
        datasets: list[Node] = []
        files: list[Node] = []

        try:
            entries = sorted(directory.iterdir(), key=lambda p: p.name.lower())
        except (OSError, PermissionError):
            return []

        for entry in entries:
            if entry.name in IGNORED_DIRS or _is_hidden(entry):
                continue
            if entry.is_symlink():
                continue  # avoid cycles; symlinked data can be added explicitly

            if entry.is_dir():
                parts = partition_parts(entry)
                if parts:
                    datasets.append(self._make_dataset(entry, "parquet", parts))
                    continue
                node = Node(
                    id=self.project.relative(entry),
                    name=entry.name,
                    kind="folder",
                    path=self.project.relative(entry),
                )
                node.children = self._walk(entry, depth + 1)
                folders.append(node)
                continue

            fmt = detect_format(entry)
            if fmt == "json" and is_localake_document(entry):
                # A saved chart: visible as a file, but never a queryable table.
                fmt = None
            if fmt:
                datasets.append(self._make_dataset(entry, fmt, [entry]))
            else:
                files.append(
                    Node(
                        id=self.project.relative(entry),
                        name=entry.name,
                        kind="file",
                        path=self.project.relative(entry),
                        size_bytes=entry.stat().st_size,
                    )
                )

        return folders + datasets + files

    def _make_dataset(self, path: Path, fmt: DataFormat, parts: list[Path]) -> Node:
        relative = self.project.relative(path)
        parent = Path(relative).parent
        schema_fragment = "" if parent in (Path("."), Path("")) else parent.as_posix()
        schema_name = sanitize_identifier(schema_fragment.replace("/", "_")) if schema_fragment else "main"
        table_name = sanitize_identifier(path.stem if path.is_file() else path.name)

        # Two files can sanitize to the same identifier (``orders.csv`` and
        # ``orders.parquet``); keep both addressable.
        candidate = table_name
        counter = 2
        while (schema_name, candidate) in self._taken:
            candidate = f"{table_name}_{counter}"
            counter += 1
        self._taken.add((schema_name, candidate))

        size = sum(p.stat().st_size for p in parts)
        modified = max((p.stat().st_mtime for p in parts), default=0.0)

        dataset = Dataset(
            id=relative,
            name=path.stem if path.is_file() else path.name,
            path=relative,
            abs_path=str(path),
            format=fmt,
            schema_name=schema_name,
            table_name=candidate,
            size_bytes=size,
            modified_at=modified,
            partitioned=path.is_dir(),
        )
        self.datasets[dataset.id] = dataset
        return Node(
            id=dataset.id,
            name=dataset.name,
            kind="dataset",
            path=relative,
            format=fmt,
            dataset_id=dataset.id,
            size_bytes=size,
        )
