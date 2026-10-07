"""Fan-out of workspace events to every connected browser tab."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

log = logging.getLogger(__name__)


class EventHub:
    """Tracks live WebSocket clients and broadcasts JSON events to them.

    Each client gets its own bounded queue: a slow consumer drops its oldest
    events instead of stalling query execution for everyone else.
    """

    def __init__(self, queue_size: int = 256) -> None:
        self._queues: set[asyncio.Queue[dict[str, Any]]] = set()
        self._queue_size = queue_size
        self._lock = asyncio.Lock()

    async def subscribe(self) -> asyncio.Queue[dict[str, Any]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=self._queue_size)
        async with self._lock:
            self._queues.add(queue)
        return queue

    async def unsubscribe(self, queue: asyncio.Queue[dict[str, Any]]) -> None:
        async with self._lock:
            self._queues.discard(queue)

    async def publish(self, event: dict[str, Any]) -> None:
        for queue in list(self._queues):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                try:
                    queue.get_nowait()
                    queue.put_nowait(event)
                except (asyncio.QueueEmpty, asyncio.QueueFull):
                    log.debug("dropped event for a saturated client")

    @property
    def client_count(self) -> int:
        return len(self._queues)
