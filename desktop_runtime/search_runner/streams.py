from __future__ import annotations

import io

from .events import emit_event


class JsonLogStream(io.TextIOBase):
    def __init__(self):
        self._buffer = ""

    def write(self, text):
        if not text:
            return 0

        self._buffer += text
        while "\n" in self._buffer:
            line, self._buffer = self._buffer.split("\n", 1)
            line = line.rstrip()
            if line:
                emit_event("log", level="info", message=line)
        return len(text)

    def flush(self):
        if self._buffer.strip():
            emit_event("log", level="info", message=self._buffer.strip())
        self._buffer = ""
