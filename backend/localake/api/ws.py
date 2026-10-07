"""WebSocket endpoint carrying query lifecycle and catalog events."""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..state import Workspace

router = APIRouter()
log = logging.getLogger(__name__)

#: Sent when idle so proxies and sleeping laptops do not silently drop the socket.
HEARTBEAT_SECONDS = 25.0


@router.websocket("/ws")
async def workspace_socket(socket: WebSocket) -> None:
    await socket.accept()
    reader = asyncio.create_task(_drain(socket))
    queue: asyncio.Queue | None = None
    hub = None

    async def sync_workspace(workspace: Workspace) -> None:
        """(Re)subscribe when the running server switches to another project."""
        nonlocal queue, hub
        if hub is not workspace.hub:
            if queue is not None and hub is not None:
                await hub.unsubscribe(queue)
            hub = workspace.hub
            queue = await hub.subscribe()
            await socket.send_json(
                {
                    "type": "hello",
                    "project": workspace.project.name,
                    "catalogVersion": workspace.catalog.version,
                }
            )

    try:
        while True:
            workspace: Workspace | None = getattr(socket.app.state, "workspace", None)
            if workspace is None:
                await socket.close(code=1013, reason="No project is open")
                return
            await sync_workspace(workspace)

            try:
                event = await asyncio.wait_for(queue.get(), timeout=HEARTBEAT_SECONDS)
            except asyncio.TimeoutError:
                await socket.send_json({"type": "ping"})
                continue
            if reader.done():
                break
            if event.get("type") == "workspace.changed":
                # Internal nudge from a project switch: loop back up so the
                # socket re-subscribes to the new workspace's event hub.
                continue
            await socket.send_json(event)
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        reader.cancel()
        if queue is not None and hub is not None:
            await hub.unsubscribe(queue)


async def _drain(socket: WebSocket) -> None:
    """Consume client frames so a disconnect is noticed promptly."""
    try:
        while True:
            await socket.receive_text()
    except (WebSocketDisconnect, RuntimeError):
        return
