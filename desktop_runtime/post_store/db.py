from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from .constants import DB_FILE


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_connection(db_path: Path | None = None) -> sqlite3.Connection:
    connection = sqlite3.connect(str(db_path or DB_FILE))
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection
