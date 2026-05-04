from __future__ import annotations

from xhs_agent import XHSAgentTool

from .constants import LOGIN_WINDOW_HEIGHT, LOGIN_WINDOW_WIDTH, WORKSPACE_ROOT
from .events import emit_event


class DesktopXHSAgentTool(XHSAgentTool):
    def __init__(self, api_key: str, base_url: str, model: str):
        super().__init__(api_key=api_key, base_url=base_url, model=model)
        self.browser_data_dir = str(WORKSPACE_ROOT / "xhs_browser_data")

    def _wait_for_captcha(self, page):
        print("检测到验证码，等待手动完成验证。")
        while self._check_captcha(page):
            page.wait_for_timeout(2000)
        page.wait_for_timeout(1500)
        print("验证码已通过，恢复搜索。")

    def _launch_browser_context(self, playwright):
        return playwright.chromium.launch_persistent_context(
            user_data_dir=self.browser_data_dir,
            headless=False,
            viewport={"width": LOGIN_WINDOW_WIDTH, "height": LOGIN_WINDOW_HEIGHT},
            locale="zh-CN",
            args=[
                f"--window-size={LOGIN_WINDOW_WIDTH},{LOGIN_WINDOW_HEIGHT}",
                "--disable-blink-features=AutomationControlled",
                "--disable-features=IsolateOrigins,site-per-process",
            ],
        )

    def _prepare_search_page(self, page):
        return None

    def _on_search_started(self, need: int, first_keyword: str):
        emit_event("status", stage="intent_parsed", need=need, keyword=first_keyword)

    def _on_round_started(self, round_num: int, current_kw: str, collected: int, need: int):
        emit_event(
            "status",
            stage="round_started",
            round=round_num,
            keyword=current_kw,
            collected=collected,
            need=need,
        )

    def _on_round_completed(self, round_num: int, accepted: int, collected: int, need: int):
        emit_event(
            "status",
            stage="round_completed",
            round=round_num,
            accepted=accepted,
            collected=collected,
            need=need,
        )

    def _on_ai_thinking(self, phase: str, message: str, round_num: int | None = None):
        emit_event(
            "status",
            stage="ai_thinking",
            phase=phase,
            message=message,
            round=round_num,
        )

    def _on_ai_decision(self, strategy_mode: str, coverage_plan: str, round_num: int | None = None):
        emit_event(
            "status",
            stage="ai_decision",
            strategy_mode=strategy_mode,
            coverage_plan=coverage_plan,
            round=round_num,
        )
