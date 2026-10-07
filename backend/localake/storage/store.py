"""File-backed metadata. JSON documents plus an append-only history log.

Deliberately not SQLite: the spec keeps relational state out of the MVP so a
project directory stays inspectable and diffable by hand.
"""

from __future__ import annotations

import os
import re
import threading
from pathlib import Path
from typing import Any

import orjson


def _atomic_write(path: Path, payload: bytes) -> None:
    """Write via a sibling temp file so a crash never truncates the original."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(payload)
    os.replace(tmp, path)


class JsonStore:
    """A single JSON document holding a list of records keyed by ``id``."""

    def __init__(self, path: Path, key: str = "id") -> None:
        self.path = path
        self.key = key
        self._lock = threading.Lock()

    def all(self) -> list[dict[str, Any]]:
        if not self.path.exists():
            return []
        try:
            data = orjson.loads(self.path.read_bytes())
        except (OSError, orjson.JSONDecodeError):
            return []
        return data if isinstance(data, list) else []

    def get(self, record_id: str) -> dict[str, Any] | None:
        return next((r for r in self.all() if r.get(self.key) == record_id), None)

    def put(self, record: dict[str, Any]) -> dict[str, Any]:
        """Insert or replace by key, keeping most-recent-first ordering."""
        with self._lock:
            records = self.all()
            record_id = record[self.key]
            records = [r for r in records if r.get(self.key) != record_id]
            records.insert(0, record)
            _atomic_write(self.path, orjson.dumps(records, option=orjson.OPT_INDENT_2))
        return record

    def delete(self, record_id: str) -> bool:
        with self._lock:
            records = self.all()
            remaining = [r for r in records if r.get(self.key) != record_id]
            if len(remaining) == len(records):
                return False
            _atomic_write(self.path, orjson.dumps(remaining, option=orjson.OPT_INDENT_2))
        return True


class HistoryLog:
    """Append-only JSONL log of executed queries, kept bounded.

    Appending stays O(1); once the log crosses ``max_entries`` it is trimmed
    back to that cap, so the file never grows without bound and ``recent`` never
    has to read more than a few thousand lines.
    """

    def __init__(self, path: Path, max_entries: int = 5000) -> None:
        self.path = path
        self.max_entries = max_entries
        self._lock = threading.Lock()
        self._count: int | None = None

    def append(self, entry: dict[str, Any]) -> None:
        with self._lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with self.path.open("ab") as handle:
                handle.write(orjson.dumps(entry) + b"\n")
            if self._count is None:
                self._count = self._count_lines()
            self._count += 1
            if self._count > self.max_entries:
                self._trim()
                self._count = self.max_entries

    def _count_lines(self) -> int:
        if not self.path.exists():
            return 0
        with self.path.open("rb") as handle:
            return sum(1 for _ in handle)

    def _trim(self) -> None:
        """Keep only the newest ``max_entries`` lines, oldest first dropped."""
        with self.path.open("rb") as handle:
            lines = handle.readlines()
        if len(lines) <= self.max_entries:
            return
        _atomic_write(self.path, b"".join(lines[-self.max_entries :]))

    def recent(self, limit: int = 200, offset: int = 0) -> list[dict[str, Any]]:
        if not self.path.exists():
            return []
        with self.path.open("rb") as handle:
            lines = handle.readlines()
        entries: list[dict[str, Any]] = []
        # Newest first; tolerate a torn final line from an interrupted write.
        for line in reversed(lines[-(self.max_entries) :]):
            if not line.strip():
                continue
            try:
                entries.append(orjson.loads(line))
            except orjson.JSONDecodeError:
                continue
        return entries[offset : offset + limit]

    def clear(self) -> None:
        with self._lock:
            self.path.unlink(missing_ok=True)
            self._count = 0


class KeyValueStore:
    """A flat JSON document of workspace preferences."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.Lock()

    def all(self) -> dict[str, Any]:
        if not self.path.exists():
            return {}
        try:
            data = orjson.loads(self.path.read_bytes())
        except (OSError, orjson.JSONDecodeError):
            return {}
        return data if isinstance(data, dict) else {}

    def get(self, key: str, default: Any = None) -> Any:
        return self.all().get(key, default)

    def set(self, key: str, value: Any) -> None:
        with self._lock:
            data = self.all()
            data[key] = value
            _atomic_write(self.path, orjson.dumps(data, option=orjson.OPT_INDENT_2))


#: Marks a JSON file as a Localake document so the catalog can skip it.
DOCUMENT_KIND = "localake.chart"
NOTEBOOK_KIND = "localake.notebook"
DOCUMENT_KINDS = (DOCUMENT_KIND, NOTEBOOK_KIND)


class DocumentStore:
    """One JSON file per record, in a folder inside the project.

    Charts live here rather than in ``.localake`` so they can be read, edited,
    diffed and committed alongside the data they describe.
    """

    def __init__(self, directory: Path, kind: str = DOCUMENT_KIND) -> None:
        self.directory = directory
        self.kind = kind
        self._lock = threading.Lock()

    def all(self) -> list[dict[str, Any]]:
        if not self.directory.is_dir():
            return []
        records = []
        for path in self.directory.glob("*.json"):
            try:
                data = orjson.loads(path.read_bytes())
            except (OSError, orjson.JSONDecodeError):
                continue
            if isinstance(data, dict) and data.get("kind") == self.kind:
                records.append(data)
        records.sort(key=lambda r: r.get("updatedAt", 0), reverse=True)
        return records

    def get(self, record_id: str) -> dict[str, Any] | None:
        return next((r for r in self.all() if r.get("id") == record_id), None)

    def put(self, record: dict[str, Any]) -> dict[str, Any]:
        record = {**record, "kind": self.kind}
        desired = _slug(record.get("name", record["id"]))
        with self._lock:
            self.directory.mkdir(parents=True, exist_ok=True)
            existing = self._path_for(record["id"])
            if existing is not None:
                target = existing
                # A rename should not leave the old file behind.
                if existing.stem != desired:
                    renamed = self.directory / f"{desired}.json"
                    if not renamed.exists():
                        existing.unlink(missing_ok=True)
                        target = renamed
            else:
                target = self.directory / f"{desired}.json"
                # Two documents can share a name; never clobber the other one's
                # file. Disambiguate with a slice of the record id.
                if target.exists():
                    target = self.directory / f"{desired}_{record['id'][:8]}.json"
            _atomic_write(target, orjson.dumps(record, option=orjson.OPT_INDENT_2))
        return record

    def delete(self, record_id: str) -> bool:
        with self._lock:
            path = self._path_for(record_id)
            if path is None:
                return False
            path.unlink(missing_ok=True)
        return True

    def _path_for(self, record_id: str) -> Path | None:
        if not self.directory.is_dir():
            return None
        for path in self.directory.glob("*.json"):
            try:
                data = orjson.loads(path.read_bytes())
            except (OSError, orjson.JSONDecodeError):
                continue
            if isinstance(data, dict) and data.get("id") == record_id:
                return path
        return None


def _slug(name: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "_", name.strip().lower()).strip("_")
    return cleaned[:60] or "chart"


def is_localake_document(path: Path) -> bool:
    """Whether a JSON file is Localake metadata rather than user data."""
    try:
        with path.open("rb") as handle:
            head = handle.read(512)
    except OSError:
        return False
    return b'"kind"' in head and any(kind.encode() in head for kind in DOCUMENT_KINDS)
