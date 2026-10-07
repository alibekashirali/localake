"""Shared request dependencies and JSON response type."""

from __future__ import annotations

from typing import Any

import orjson
from fastapi import HTTPException, Request, Response

from ..state import Workspace


class ORJSONResponse(Response):
    """orjson keeps large result pages cheap to serialise."""

    media_type = "application/json"

    def render(self, content: Any) -> bytes:
        return orjson.dumps(content, option=orjson.OPT_SERIALIZE_NUMPY)


def get_workspace(request: Request) -> Workspace:
    workspace: Workspace | None = getattr(request.app.state, "workspace", None)
    if workspace is None:
        raise HTTPException(status_code=409, detail="No project is open")
    return workspace
