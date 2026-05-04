from __future__ import annotations

import contextlib
import json
import os
import sys

from desktop_runtime.post_store import upsert_posts

from xhs_agent.config import resolve_llm_config_from_env

from .constants import RESULT_FILE, WORKSPACE_ROOT
from .events import emit_event
from .streams import JsonLogStream
from .tool import DesktopXHSAgentTool


def load_payload() -> dict:
    raw = sys.stdin.read().strip()
    if not raw:
        return {}
    return json.loads(raw)


def validate_query(payload: dict) -> str:
    query = (payload.get("query") or "").strip()
    if not query:
        emit_event("error", message="缺少搜索需求。")
        raise SystemExit(1)
    return query


def validate_runtime_environment() -> dict:
    ai_config = resolve_llm_config_from_env()
    if not ai_config["api_key"]:
        emit_event("error", message="未找到 OPENAI_API_KEY，请先在主页 AI 设置中完成配置。")
        raise SystemExit(1)
    if not ai_config["base_url"]:
        emit_event("error", message="未找到 OPENAI_BASE_URL，请先在主页 AI 设置中完成配置。")
        raise SystemExit(1)
    if not ai_config["model"]:
        emit_event("error", message="未找到 OPENAI_MODEL，请先在主页 AI 设置中完成配置。")
        raise SystemExit(1)

    browser_data_dir = WORKSPACE_ROOT / "xhs_browser_data"
    if not browser_data_dir.exists():
        emit_event("error", message="未找到 xhs_browser_data，请先在桌面端完成登录。")
        raise SystemExit(1)

    return ai_config


def persist_results(results: list[dict], query: str) -> None:
    upsert_posts(results, source_query=query)
    RESULT_FILE.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")


def execute_search(query: str, ai_config: dict) -> list[dict]:
    tool = DesktopXHSAgentTool(
        api_key=ai_config["api_key"],
        base_url=ai_config["base_url"],
        model=ai_config["model"],
    )
    log_stream = JsonLogStream()

    try:
        with contextlib.redirect_stdout(log_stream):
            results = tool.run(query)
        log_stream.flush()
        return results
    except Exception:
        log_stream.flush()
        raise


def main() -> None:
    payload = load_payload()
    query = validate_query(payload)
    ai_config = validate_runtime_environment()

    try:
        results = execute_search(query, ai_config)
        persist_results(results, query)
        emit_event("result", results=results, output_file=str(RESULT_FILE))
    except Exception as error:
        emit_event("error", message=str(error))
        raise


if __name__ == "__main__":
    main()
