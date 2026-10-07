"""Test isolation.

``localake.config`` resolves its application directory at import time, so the
override has to be in place before the package is first imported — otherwise a
test run rewrites the developer's own recent-projects list.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

_APP_HOME = Path(tempfile.mkdtemp(prefix="localake-tests-"))
os.environ["LOCALAKE_HOME"] = str(_APP_HOME)
