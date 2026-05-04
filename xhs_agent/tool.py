import random

from desktop_runtime.post_store import load_posts
from openai import OpenAI
from playwright.sync_api import sync_playwright

from . import browser, intent, runner, scoring
from .config import resolve_llm_config_from_env
from .constants import FILTER_COORDS
from .utils import normalize_title_key


class XHSAgentTool:
    def __init__(self, api_key: str, base_url: str | None = None, model: str | None = None):
        self.browser_data_dir = './xhs_browser_data'
        llm_config = resolve_llm_config_from_env()
        self.model = model or llm_config['model']
        self.llm = OpenAI(
            api_key=api_key,
            base_url=base_url or llm_config['base_url'],
        )
        self.filter_coords = FILTER_COORDS
        self._pending_cards: list[dict] = []
        self._seen_ids: set[str] = set()
        self._global_seen_ids: set[str] = set()
        self._detail_buffer: dict = {}
        self._active: bool = False
        self._collecting: bool = False
        self._stored_title_keys: set[str] = set()

    def _on_response_search(self, response):
        return browser.on_response_search(self, response)

    def _on_response_detail(self, response):
        return browser.on_response_detail(self, response)

    def _parse_card(self, item: dict) -> dict:
        return browser.parse_card(item)

    def _apply_filter(self, page, sort='综合', note_type='不限', time_range='不限', search_scope='不限', location='不限'):
        return browser.apply_filter(self, page, sort, note_type, time_range, search_scope, location)

    def _check_captcha(self, page) -> bool:
        return browser.check_captcha(page)

    def _wait_for_captcha(self, page):
        return browser.wait_for_captcha(page)

    def _launch_browser_context(self, playwright):
        return playwright.chromium.launch_persistent_context(
            user_data_dir=self.browser_data_dir,
            headless=False,
            viewport={'width': 1280, 'height': 720},
            locale='zh-CN',
            args=[
                '--disable-blink-features=AutomationControlled',
                '--disable-features=IsolateOrigins,site-per-process',
            ],
        )

    def _prepare_search_page(self, page):
        page.goto('https://www.xiaohongshu.com', wait_until='domcontentloaded')
        page.wait_for_timeout(2000)
        is_logged_in = page.evaluate("""
            () => {
                const avatar = document.querySelector('.avatar, [class*="avatar"]');
                const loginBtn = document.querySelector('[class*="login"]');
                return avatar !== null && loginBtn === null;
            }
        """)
        if not is_logged_in:
            print('未登录，请手动登录后按回车...')
            input()

    def _on_search_started(self, need: int, first_keyword: str):
        return None

    def _on_round_started(self, round_num: int, current_kw: str, collected: int, need: int):
        return None

    def _on_round_completed(self, round_num: int, accepted: int, collected: int, need: int):
        return None

    def _on_ai_thinking(self, phase: str, message: str, round_num: int | None = None):
        return None

    def _on_ai_decision(self, strategy_mode: str, coverage_plan: str, round_num: int | None = None):
        return None

    def _wait_after_card_click(self, page):
        page.wait_for_timeout(random.randint(300, 600))

    def _wait_after_scroll(self, page):
        page.wait_for_timeout(random.randint(1000, 1500))

    def _load_stored_title_keys(self) -> set[str]:
        try:
            posts = load_posts()
        except Exception as error:
            print(f'  [标题去重] 加载数据库失败，跳过去重: {error}')
            self._stored_title_keys = set()
            return self._stored_title_keys

        self._stored_title_keys = {
            normalize_title_key(post.get('title', ''))
            for post in posts
            if normalize_title_key(post.get('title', ''))
        }
        print(f'  [标题去重] 数据库标题 {len(self._stored_title_keys)} 条')
        return self._stored_title_keys

    def _filter_duplicate_titles(self, posts: list[dict], existing_posts: list[dict]) -> tuple[list[dict], list[dict]]:
        db_title_keys = self._load_stored_title_keys()
        existing_title_keys = {
            normalize_title_key(post.get('title', ''))
            for post in existing_posts
            if normalize_title_key(post.get('title', ''))
        }
        seen_title_keys = set(db_title_keys)
        seen_title_keys.update(existing_title_keys)

        unique_posts: list[dict] = []
        duplicate_posts: list[dict] = []
        local_seen_keys: set[str] = set()
        for post in posts:
            title_key = normalize_title_key(post.get('title', ''))
            if not title_key:
                unique_posts.append(post)
                continue
            if title_key in seen_title_keys or title_key in local_seen_keys:
                duplicate_posts.append(post)
                continue
            local_seen_keys.add(title_key)
            unique_posts.append(post)

        return unique_posts, duplicate_posts

    def _llm_call(self, prompt: str, temperature: float = 0.2) -> dict:
        return scoring.llm_call(self, prompt, temperature)

    def _mark_visible_cards(self, page):
        return browser.mark_visible_cards(page)

    def _click_card(self, page, card: dict) -> bool:
        return browser.click_card(self, page, card)

    def _apply_score_filter_changes(self, page, score_result: dict, sort: str, time_range: str, note_type: str, search_scope: str, location: str):
        return browser.apply_score_filter_changes(self, page, score_result, sort, time_range, note_type, search_scope, location)

    def _llm_score_cards(self, cards: list[dict], user_query: str, filter_prompt: str, already_have: int, need: int, sort: str = '综合', time_range: str = '不限', intent_context: dict | None = None, existing_results: list | None = None, strategy_mode: str = 'explore', coverage_plan: str = '') -> dict:
        return scoring.llm_score_cards(self, cards, user_query, filter_prompt, already_have, need, sort, time_range, intent_context, existing_results, strategy_mode, coverage_plan)

    def _llm_evaluate(self, user_query: str, filter_prompt: str, new_posts: list[dict], existing_results: list[dict], need: int, used_keywords: list[str], current_sort: str, current_time_range: str, intent_context: dict | None = None, count_specified: bool = True) -> dict:
        return scoring.llm_evaluate(self, user_query, filter_prompt, new_posts, existing_results, need, used_keywords, current_sort, current_time_range, intent_context, count_specified)

    def classify_intent(self, user_query: str) -> dict:
        return intent.classify_intent(self, user_query)

    def build_search_plan(self, user_query: str, intent_context: dict) -> dict:
        return intent.build_search_plan(self, user_query, intent_context)

    def _append_filter_prompt(self, base_prompt: str, extra_prompt: str) -> str:
        return intent.append_filter_prompt(base_prompt, extra_prompt)

    def _apply_intent_rules(self, user_query: str, plan: dict, intent_context: dict) -> dict:
        return intent.apply_intent_rules(user_query, plan, intent_context)

    def parse_intent(self, user_query: str) -> dict:
        self._on_ai_thinking('intent_classification', 'AI 正在理解你的需求')
        intent_context = self.classify_intent(user_query)
        self._on_ai_thinking('search_planning', 'AI 正在生成搜索计划')
        plan = self.build_search_plan(user_query, intent_context)
        merged = self._apply_intent_rules(user_query, plan, intent_context)
        print('\n[搜索计划]')
        for key, value in merged.items():
            if key == 'intent_context':
                continue
            print(f'  {key}: {value}')
        return merged

    def run(self, user_query: str) -> list[dict]:
        with sync_playwright() as playwright:
            context = self._launch_browser_context(playwright)
            try:
                return runner.run_agent(self, user_query, context)
            finally:
                self._active = False
                context.close()
