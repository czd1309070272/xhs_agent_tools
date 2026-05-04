from __future__ import annotations

import json
import sys


def emit_event(event_type: str, **payload) -> None:
    event = {"type": event_type, **payload}
    sys.__stdout__.write(json.dumps(event, ensure_ascii=False) + "\n")
    sys.__stdout__.flush()
