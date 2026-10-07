"""``localake`` — start the workspace server and open the browser."""

from __future__ import annotations

import argparse
import logging
import socket
import sys
import threading
import webbrowser
from pathlib import Path

import uvicorn

from . import __version__
from .config import DEFAULT_HOST, DEFAULT_PORT, AppState
from .project.model import ProjectError, open_project


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="localake", description="Local-first data workspace")
    parser.add_argument(
        "path", nargs="?", help="project directory (default: the last one you opened)"
    )
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument(
        "--allow-remote",
        action="store_true",
        help="permit binding to a non-loopback address (see the warning it prints)",
    )
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--no-browser", action="store_true", help="do not open a browser window")
    parser.add_argument("--no-watch", action="store_true", help="disable filesystem watching")
    parser.add_argument("--reload", action="store_true", help="reload on backend code changes")
    parser.add_argument("--log-level", default="info")
    parser.add_argument("--version", action="version", version=f"localake {__version__}")
    return parser


LOOPBACK = {"127.0.0.1", "localhost", "::1", "0:0:0:0:0:0:0:1"}

REMOTE_WARNING = """\
localake: refusing to listen on {host} without --allow-remote.

  Localake has no authentication, and its SQL editor can read and write any
  file the server process can reach. Exposing it on a network gives anyone who
  reaches the port full access to this machine's filesystem.

  To use Localake from another machine, forward the port over SSH instead:

      ssh -L 3000:127.0.0.1:3000 you@this-machine

  If you understand the risk and the port is genuinely protected, pass
  --allow-remote.
"""


def is_loopback(host: str) -> bool:
    return host.strip().lower() in LOOPBACK


def resolve_path(raw: str | None) -> Path:
    if raw:
        return Path(raw).expanduser().resolve()
    last = AppState.load().last_project
    if last and Path(last).is_dir():
        return Path(last)
    return Path.cwd()


def port_in_use(host: str, port: int, timeout: float = 0.25) -> bool:
    """Whether something is actually accepting connections on ``host:port``.

    Connecting beats binding as a test. A bind probe reports a port busy while
    a just-closed socket sits in TIME_WAIT — so restarting Localake would keep
    walking up the port range — and, with SO_REUSEADDR, wrongly reports a port
    free when another server holds the 0.0.0.0 wildcard.
    """
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(timeout)
        return probe.connect_ex((host, port)) == 0


def find_free_port(host: str, preferred: int, attempts: int = 20) -> int | None:
    """The preferred port, or the next one nobody is listening on."""
    for candidate in range(preferred, preferred + attempts):
        if not port_in_use(host, candidate):
            return candidate
    return None


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(
        level=args.log_level.upper(), format="%(levelname)s  %(name)s  %(message)s"
    )

    if not is_loopback(args.host) and not args.allow_remote:
        print(REMOTE_WARNING.format(host=args.host), file=sys.stderr)
        return 2

    path = resolve_path(args.path)
    try:
        project = open_project(path)
    except ProjectError as exc:
        print(f"localake: {exc}", file=sys.stderr)
        return 1

    port = find_free_port(args.host, args.port)
    if port is None:
        print(
            f"localake: no free port between {args.port} and {args.port + 19}",
            file=sys.stderr,
        )
        return 1
    if port != args.port:
        print(f"  note      port {args.port} is in use, using {port} instead", flush=True)
    args.port = port

    url = f"http://{args.host}:{args.port}"
    print(f"\n  Localake  {__version__}", flush=True)
    print(f"  project   {project.name}  ({project.root})", flush=True)
    print(f"  url       {url}")
    if is_loopback(args.host):
        print("  mode      local — no data leaves this machine\n", flush=True)
    else:
        print(
            "  mode      REMOTE — no authentication, full filesystem access\n",
            flush=True,
        )

    if not args.no_browser and not args.reload:
        # Delay just enough for uvicorn to bind before the tab requests the page.
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()

    from .app import create_app

    if args.reload:
        # Reload needs an import string, so the project is passed via the env.
        import os

        os.environ["LOCALAKE_PROJECT"] = str(project.root)
        os.environ["LOCALAKE_WATCH"] = "0" if args.no_watch else "1"
        os.environ["LOCALAKE_REMOTE"] = "0" if is_loopback(args.host) else "1"
        uvicorn.run(
            "localake.app_factory:app",
            host=args.host,
            port=args.port,
            reload=True,
            log_level=args.log_level,
        )
        return 0

    uvicorn.run(
        create_app(
            project.root,
            watch=not args.no_watch,
            remote=not is_loopback(args.host),
        ),
        host=args.host,
        port=args.port,
        log_level=args.log_level,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
