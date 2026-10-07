"""The wheel has to carry the UI; a dev install must not need Node."""

from __future__ import annotations

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_hook_module():
    spec = importlib.util.spec_from_file_location(
        "localake_hatch_build", ROOT / "scripts" / "hatch_build.py"
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_editable_install_skips_the_frontend_build() -> None:
    """`uv sync` must work on a machine with no Node, or backend CI breaks."""
    hook = object.__new__(load_hook_module().CustomBuildHook)

    build_data: dict[str, dict] = {"force_include": {}}
    hook.initialize("editable", build_data)

    assert build_data["force_include"] == {}


def test_the_server_finds_the_bundled_ui_first(tmp_path, monkeypatch) -> None:
    """An installed package serves localake/web, not a stale repo build."""
    from localake import app as app_module

    packaged = tmp_path / "localake" / "web"
    packaged.mkdir(parents=True)
    (packaged / "index.html").write_text("<!doctype html>packaged")
    monkeypatch.setattr(app_module, "__file__", str(tmp_path / "localake" / "app.py"))

    assert app_module.find_frontend() == packaged


def test_project_metadata_is_publishable() -> None:
    """PyPI rejects a project without these, and users need the repo link."""
    text = (ROOT / "pyproject.toml").read_text()
    for field in ('license = "Apache-2.0"', "[project.urls]", 'name = "localake"'):
        assert field in text, f"missing {field} in pyproject.toml"
    assert (ROOT / "LICENSE").is_file()
    assert "Apache License" in (ROOT / "LICENSE").read_text()


def test_a_network_address_needs_an_explicit_opt_in() -> None:
    """No auth plus arbitrary file access means remote binding must be deliberate."""
    from localake.cli import is_loopback, main

    assert is_loopback("127.0.0.1")
    assert is_loopback("localhost")
    assert not is_loopback("0.0.0.0")
    assert not is_loopback("192.168.1.10")

    # Refused, and refused before anything is opened or served.
    assert main(["--host", "0.0.0.0", "--no-browser", "/tmp"]) == 2
