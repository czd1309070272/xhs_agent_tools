"""
小红书 Agent Tool
流程: 用户需求 → LLM生成关键词 → 边滚动边拦截边点击（卡片出现立刻处理）→
      积累正文后 LLM 评估 → 满足则退出，不满足换关键词继续
"""
import json
import random
import os
from datetime import date
from openai import OpenAI
from playwright.sync_api import sync_playwright
from dotenv import load_dotenv

load_dotenv()

# ── 筛选面板坐标图（基于实测 1280x720）──────────────────────────────
FILTER_COORDS = {
    'sort': {
        '综合':    (844, 197),
        '最新':    (952, 197),
        '最多点赞': (1076, 197),
        '最多评论': (1184, 197),
        '最多收藏': (860, 247),
    },
    'type': {
        '不限': (876, 344),
        '视频': (952, 334),
        '图文': (1060, 334),
    },
    'time': {
        '不限':   (876, 432),
        '一天内':  (960, 421),
        '一周内': (1068, 421),
        '半年内': (1176, 421),
    },
    'range': {
        '不限':   (876, 519),
        '已看过':  (960, 508),
        '未看过': (1068, 508),
        '已关注': (1176, 508),
    },
    'location': {
        '不限': (844, 595),
        '同城': (952, 595),
        '附近': (1060, 595),
    },
}
FILTER_BTN  = (1204, 108)
CLOSE_PANEL = (600, 400)

DETAIL_URL_KEYWORDS = ['/feed', '/note/', 'web/v1/note', 'web/v2/note']


class XHSAgentTool:
    def __init__(self, deepseek_api_key: str):
        self.browser_data_dir = './xhs_browser_data'
        self.model = os.environ.get('DEEPSEEK_MODEL', 'deepseek-chat')
        self.llm = OpenAI(
            api_key=deepseek_api_key,
            base_url='https://api.deepseek.com'
        )
        self._pending_cards: list[dict] = []  # 每次滚动后新拦截到的，处理完清空
        self._seen_ids: set[str] = set()        # 轮内去重（筛选切换时重置）
        self._global_seen_ids: set[str] = set() # 跨轮去重，整个 run() 生命周期
        self._detail_buffer: dict = {}
        self._active: bool = False
        self._collecting: bool = False

    # ── 网络拦截回调 ──────────────────────────────────────────────────

    def _on_response_search(self, response):
        if not self._active:
            return
        if not self._collecting:
            return
        if 'search/notes' not in response.url:
            return
        try:
            data = response.json()
            items = data.get('data', {}).get('items', [])
            new = 0
            for item in items:
                if item.get('model_type') != 'note':
                    continue
                pid = item.get('id')
                if not pid or pid in self._seen_ids or pid in self._global_seen_ids:
                    continue
                self._seen_ids.add(pid)
                self._global_seen_ids.add(pid)
                self._pending_cards.append(self._parse_card(item))
                new += 1
            if new:
                print(f'  [拦截] +{new} 条新卡片')
        except Exception:
            pass

    def _on_response_detail(self, response):
        if not self._active:
            return
        if not any(k in response.url for k in DETAIL_URL_KEYWORDS):
            return
        try:
            data = response.json()
            note = (
                data.get('data', {}).get('note_detail_map', {})
                or data.get('data', {}).get('items', [{}])[0]
                or data.get('data', {})
            )
            card = note.get('note_card') or note.get('noteInfo') or note
            content = card.get('desc') or card.get('description') or card.get('content') or ''
            tags = [t.get('name') or t.get('text') for t in card.get('tag_list', [])
                    if t.get('name') or t.get('text')]
            if content:
                self._detail_buffer[response.url] = {'content': content, 'tags': tags}
                print(f'  [详情拦截] 正文 {len(content)} 字')
        except Exception:
            pass

    # ── 数据解析 ──────────────────────────────────────────────────────

    def _parse_card(self, item: dict) -> dict:
        card     = item.get('note_card', {})
        user     = card.get('user', {})
        interact = card.get('interact_info', {})
        pub_time = ''
        for tag in card.get('corner_tag_info', []):
            if tag.get('type') == 'publish_time':
                pub_time = tag.get('text', '')
                break
        images = []
        for img in card.get('image_list', []):
            for info in img.get('info_list', []):
                if info.get('image_scene') == 'WB_DFT':
                    images.append(info['url'])
                    break
        return {
            'id':            item.get('id', ''),
            'url':           f'https://www.xiaohongshu.com/explore/{item.get("id", "")}',
            'title':         card.get('display_title', ''),
            'type':          card.get('type', ''),
            'author':        user.get('nickname', ''),
            'author_id':     user.get('user_id', ''),
            'publishedTime': pub_time,
            'likes':         interact.get('liked_count', '0'),
            'comments':      interact.get('comment_count', '0'),
            'collects':      interact.get('collected_count', '0'),
            'shares':        interact.get('shared_count', '0'),
            'images':        images,
            'content':       '',
            'tags':          [],
        }

    # ── 筛选面板 ──────────────────────────────────────────────────────

    def _apply_filter(self, page, sort='综合', note_type='不限',
                      time_range='不限', search_scope='不限', location='不限'):
        self._collecting = False  # 筛选期间不收集，等筛选结果加载完再开始
        page.evaluate('window.scrollTo(0, 0)')
        page.wait_for_timeout(random.randint(500, 800))
        # 清除筛选前拦截到的卡片，避免污染后续逻辑
        self._pending_cards = []
        self._seen_ids = set()
        page.mouse.move(FILTER_BTN[0], FILTER_BTN[1])
        page.wait_for_timeout(random.randint(700, 1000))
        for value, key in [(sort, 'sort'), (note_type, 'type'), (time_range, 'time'),
                           (search_scope, 'range'), (location, 'location')]:
            if value == '不限':
                continue
            coords = FILTER_COORDS.get(key, {}).get(value)
            if coords:
                print(f'  筛选 {key} → {value}')
                page.mouse.click(coords[0], coords[1])
                page.wait_for_timeout(random.randint(300, 500))
        page.mouse.click(CLOSE_PANEL[0], CLOSE_PANEL[1])
        page.wait_for_timeout(random.randint(1500, 2000))  # 等筛选结果重新加载
        # 再次清空，丢弃筛选动作期间漏进来的数据，从干净状态开始收集
        self._pending_cards = []
        self._seen_ids = set()
        self._collecting = True
        print('  [筛选完成] 开始收集')

    # ── 验证码检测 ────────────────────────────────────────────────────

    def _check_captcha(self, page) -> bool:
        try:
            return page.evaluate("""
                () => {
                    const el = document.querySelector(
                        '[class*="captcha"], [id*="captcha"], '
                        + '[class*="slider-verify"], [class*="slide-verify"], '
                        + '[class*="verify-wrap"], '
                        + 'canvas[id*="captcha"], canvas[class*="captcha"]'
                    );
                    return el !== null;
                }
            """)
        except Exception:
            return False

    def _wait_for_captcha(self, page):
        print('\n' + '!'*55)
        print('! 检测到验证码，请在浏览器中手动完成验证')
        print('! 完成后按回车继续...')
        print('!'*55)
        input()
        page.wait_for_timeout(2000)
        print('[继续] 验证完成，恢复搜索')

    # ── 点赞数解析 ────────────────────────────────────────────────────

    # ── LLM 调用（带重试）────────────────────────────────────────────

    def _llm_call(self, prompt: str, temperature: float = 0.2) -> dict:
        for attempt in range(3):
            try:
                resp = self.llm.chat.completions.create(
                    model=self.model,
                    messages=[{'role': 'user', 'content': prompt}],
                    temperature=temperature,
                )
                raw = resp.choices[0].message.content.strip().strip('`')
                if raw.startswith('json'):
                    raw = raw[4:]
                result = json.loads(raw)
                return result if isinstance(result, dict) else {}
            except Exception as e:
                if attempt == 2:
                    print(f'  [LLM错误] 连续3次失败: {e}')
                    raise
                print(f'  [LLM重试] 第{attempt+1}次失败: {e}')
        return {}


    def _mark_visible_cards(self, page):
        """给当前 DOM 里的卡片打 data-post-id，返回当前可见的 id 集合"""
        result = page.evaluate("""
            () => {
                const visible = [];
                const links = document.querySelectorAll('a[href*="/explore/"]');
                for (const link of links) {
                    const href = link.getAttribute('href');
                    const m = href.match(/\\/explore\\/([a-zA-Z0-9]+)/);
                    if (!m) continue;
                    const postId = m[1];
                    let el = link;
                    let cur = link.parentElement;
                    for (let d = 0; d < 10; d++) {
                        if (!cur) break;
                        const r = cur.getBoundingClientRect();
                        if (r.width > 100 && r.height > 100) { el = cur; break; }
                        cur = cur.parentElement;
                    }
                    el.setAttribute('data-post-id', postId);
                    visible.push(postId);
                }
                return visible;
            }
        """)
        return set(result)

    # ── 点击单张卡片获取正文 ──────────────────────────────────────────

    def _click_card(self, page, card: dict) -> bool:
        """点击卡片打开悬浮面板，获取正文。返回是否成功"""
        self._detail_buffer.clear()
        locator = page.locator(f'[data-post-id="{card["id"]}"]').first
        if locator.count() == 0:
            return False
        try:
            locator.scroll_into_view_if_needed(timeout=5000)
            page.wait_for_timeout(random.randint(200, 400))
            locator.click(timeout=8000)
            page.wait_for_timeout(random.randint(1200, 1800))

            if self._check_captcha(page):
                self._wait_for_captcha(page)

            page.wait_for_timeout(random.randint(500, 800))

            # 优先 API 正文
            for entry in self._detail_buffer.values():
                if entry.get('content'):
                    card['content'] = entry['content']
                    card['tags']    = entry.get('tags', [])
                    break

            # 降级 DOM
            if not card['content']:
                card['content'] = page.evaluate("""
                    () => {
                        const sels = ['#detail-desc', '[class*="note-content"]', '[class*="desc"]'];
                        for (const s of sels) {
                            const el = document.querySelector(s);
                            if (el && el.innerText.trim().length > 10)
                                return el.innerText.trim();
                        }
                        return '';
                    }
                """)

            page.keyboard.press('Escape')
            page.wait_for_timeout(random.randint(600, 1000))
            return True

        except Exception as e:
            print(f'  [ERROR] 点击失败: {e}')
            try:
                page.keyboard.press('Escape')
            except Exception:
                pass
            return False

    # ── 应用打分阶段的筛选调整 ────────────────────────────────────────

    def _apply_score_filter_changes(self, page, score_result: dict,
                                    sort: str, time_range: str,
                                    note_type: str, search_scope: str, location: str):
        """如果 LLM 打分时建议调整筛选，立即重新应用筛选面板。返回 (sort, time_range, changed)"""
        new_sort = score_result.get('next_sort')
        new_time_range = score_result.get('next_time_range')
        changed = False
        if new_sort and new_sort in FILTER_COORDS.get('sort', {}) and new_sort != sort:
            print(f'  [筛选调整] sort: {sort} → {new_sort}')
            sort = new_sort
            changed = True
        if new_time_range and new_time_range in FILTER_COORDS.get('time', {}) and new_time_range != time_range:
            print(f'  [筛选调整] time_range: {time_range} → {new_time_range}')
            time_range = new_time_range
            changed = True
        if changed:
            self._apply_filter(page, sort, note_type, time_range, search_scope, location)
        return sort, time_range, changed

    # ── LLM：打分选出要点击的 ────────────────────────────────────────

    def _llm_score_cards(self, cards: list[dict], user_query: str,
                         filter_prompt: str, already_have: int, need: int,
                         sort: str = '综合', time_range: str = '不限',
                         existing_results: list = None) -> dict:
        still_need = need - already_have
        max_click  = min(3, still_need)

        summary = [{
            'id':            c['id'],
            'title':         c['title'],
            'author':        c['author'],
            'likes':         c['likes'],
            'comments':      c['comments'],
            'collects':      c['collects'],
            'publishedTime': c['publishedTime'],
            'type':          c['type'],
        } for c in cards]

        existing_hint = ''
        if existing_results:
            existing_summary = [
                f'《{p["title"]}》' + (f' 标签: {", ".join(p["tags"][:5])}' if p.get("tags") else '')
                for p in existing_results
            ]
            existing_hint = f"""
已收录内容（选帖时避免同质化，优先覆盖还未涉及的角度）：
{chr(10).join(f"- {s}" for s in existing_summary)}
"""

        stop_hint = ''
        if sort == '最多点赞':
            stop_hint = """
- 当前排序为"最多点赞"，结果是点赞降序排列
- 如果这批卡片整体点赞数已经很低（与话题热度相比不值得继续看），将 stop_scroll 设为 true
- 判断标准：结合话题冷热程度，niche话题（如claude code）50赞可能已算高，热门话题1000赞才算入门
- 如果这批中还有相对高质量的内容，stop_scroll 设为 false 继续滚"""

        time_hint = ''
        if filter_prompt and '时效限制' in filter_prompt:
            today = date.today().isoformat()
            time_hint = f"""
今天日期：{today}（用于将"N天前"等相对时间换算成绝对日期后判断时效）
时效筛选规则（优先级高，务必执行）：
- publishedTime 在 15天内：优先选，不受其他条件限制
- publishedTime 在 16天～1个月内：内容质量明显高于同批其他帖子时才选
- publishedTime 超过 1个月：即使内容再好也不选，直接跳过
- publishedTime 为空或无法判断：按内容质量正常评分，不强制排除"""

        prompt = f"""你是小红书内容筛选助手。

用户需求：{user_query}
{f'筛选标准：{filter_prompt}' if filter_prompt else ''}
目前已有 {already_have} 条，还需要 {still_need} 条。
当前筛选：sort={sort}，time_range={time_range}
{existing_hint}{time_hint}
以下是刚加载出来的帖子：
{json.dumps(summary, ensure_ascii=False, indent=2)}

任务1：选出最值得点进去看完整内容的帖子，选 {max_click} 条。
规则：
- 候选帖子数量足够时，必须选满 {max_click} 条，不能少
- 相关度判断：帖子是否与用户需求的主题/领域相关，不要求标题完全匹配关键词
  - 例如用户要"claude code skills"，标题含 Claude、AI编程、MCP、提示词工程等都算相关
  - 宁可选主题相近的，也不要因为没有完整关键词就排除
- 按相关度排序，取前 {max_click} 名，宁可选相关度一般的，也不要留空
- 同时判断是否需要继续向下滚动加载更多{stop_hint}

任务2：判断当前筛选条件是否合适，如需调整立即生效（不等本轮结束）。
可用值：
- sort: 综合 / 最新 / 最多点赞 / 最多评论 / 最多收藏
- time_range: 不限 / 一天内 / 一周内 / 半年内
调整依据：
- 这批帖子与用户需求完全不搭 → 考虑换 sort（如最多点赞换综合/最新）
- 帖子数量明显偏少 → 考虑放宽 time_range（如一周内→半年内）
- 条件合适就返回 null，不要随意调整

只返回 JSON：
{{"ids": ["id1", "id2"], "stop_scroll": false, "next_sort": null, "next_time_range": null}}"""

        result = self._llm_call(prompt, temperature=0.2)
        ids = result.get('ids', [])
        stop = result.get('stop_scroll', False)
        next_sort = result.get('next_sort')
        next_time_range = result.get('next_time_range')
        msg = f'  [LLM打分] {len(cards)} 条中选 {len(ids)} 条，stop_scroll={stop}'
        if next_sort:
            msg += f'，建议换sort→{next_sort}'
        if next_time_range:
            msg += f'，建议换time_range→{next_time_range}'
        print(msg)
        return {'ids': ids, 'stop_scroll': stop, 'next_sort': next_sort, 'next_time_range': next_time_range}

    # ── LLM：评估正文质量，决定是否继续 ─────────────────────────────

    def _llm_evaluate(self, user_query: str, filter_prompt: str,
                      new_posts: list[dict], existing_results: list[dict],
                      need: int, used_keywords: list[str],
                      current_sort: str, current_time_range: str,
                      count_specified: bool = True) -> dict:
        posts_summary = [{
            'id':      p['id'],
            'title':   p['title'],
            'content': p['content'][:300] if p['content'] else '（未获取到正文）',
            'likes':   p['likes'],
            'publishedTime': p.get('publishedTime', ''),
        } for p in new_posts]

        time_hint = ''
        if filter_prompt and '时效限制' in filter_prompt:
            today = date.today().isoformat()
            time_hint = f"""
今天日期：{today}（用于将"N天前"等相对时间换算成绝对日期后判断时效）
时效筛选规则（优先级高，务必执行）：
- publishedTime 在 15天内：优先接受，内容相关即可
- publishedTime 在 16天～1个月内：内容质量明显高于同批时才接受
- publishedTime 超过 1个月：即使内容再好也不接受，不加入 accepted_ids
- publishedTime 为空：按内容质量正常评估，不强制排除
"""

        existing_hint = ''
        if existing_results:
            existing_summary = [
                f'《{p["title"]}》：{p["content"][:80] if p["content"] else "无正文"}'
                for p in existing_results
            ]
            existing_hint = f"""
已收录内容（下一关键词应覆盖还未涉及的角度，避免与这些重复）：
{chr(10).join(f"- {s}" for s in existing_summary)}
"""

        satisfied_rule = (
            f"- 用户明确指定了数量（{need} 条），达到该数量才能将 satisfied 设为 true"
            if count_specified else
            f"- 用户未指定数量，上限 {need} 条；已有内容能全面覆盖用户需求的主要角度时即可将 satisfied 设为 true，不必凑满 {need} 条"
        )

        prompt = f"""你是小红书内容质量评估助手。

用户需求：{user_query}
{f'筛选标准：{filter_prompt}' if filter_prompt else ''}
目标：{need} 条（{'用户指定' if count_specified else '系统上限，非用户指定'}），已有：{len(existing_results)} 条
已用关键词：{used_keywords}
当前筛选：sort={current_sort}，time_range={current_time_range}
{existing_hint}{time_hint}
本轮获取的帖子（含正文片段）：
{json.dumps(posts_summary, ensure_ascii=False, indent=2) if posts_summary else '（本轮未获取到任何帖子正文）'}

重要规则：
- 用户需求是一个主题/意图，不是要精确匹配标题或指定某篇帖子
- 判断标准：帖子内容是否与用户的主题需求相关，内容是否有价值
- 不要因为标题不完全匹配用户描述就拒绝
- 不要因为点赞数不等于用户描述的数字就拒绝

可用筛选值：
- sort: 综合 / 最新 / 最多点赞 / 最多评论 / 最多收藏
- time_range: 不限 / 一天内 / 一周内 / 半年内

请判断：
1. 哪些帖子真正符合用户需求（内容相关、质量好）
2. 是否已满足需求：
   {satisfied_rule}
3. 如不满足，给出下一个搜索关键词，并决定是否需要调整筛选条件
   - 关键词需符合小红书用户的真实搜索习惯：口语化、带场景词（测评/攻略/避坑/推荐/好用吗）、
     结合网络流行词（平替/好物/宝藏/种草），2-6字为佳，避免书面化表达
   - 若本轮帖子数量稀少或质量差是因为 time_range 太窄，建议放宽（如一周内→半年内）
   - 若本轮帖子质量差是因为 sort 方式不合适，建议切换（如最多点赞→最新）
   - 若筛选条件没问题，只是关键词不好，保持原筛选不变（返回 null）

只返回 JSON：
{{
  "accepted_ids": ["id列表"],
  "satisfied": true或false,
  "next_keyword": "下一关键词",
  "next_sort": null或"新sort值",
  "next_time_range": null或"新time_range值",
  "reason": "简短说明"
}}"""

        decision = self._llm_call(prompt, temperature=0.2)
        print(f'  [LLM评估] 接受 {len(decision.get("accepted_ids", []))} 条 | '
              f'satisfied={decision.get("satisfied")} | {decision.get("reason", "")}')
        if decision.get('next_sort') or decision.get('next_time_range'):
            print(f'  [LLM评估] 调整筛选: sort={decision.get("next_sort")} time_range={decision.get("next_time_range")}')
        return decision

    # ── 意图解析 ──────────────────────────────────────────────────────

    def parse_intent(self, user_query: str) -> dict:
        prompt = f"""你是小红书搜索助手，把用户需求解析成搜索参数。

可用参数值：
- sort（只能选一个）: 综合 / 最新 / 最多点赞 / 最多评论 / 最多收藏
- note_type: 不限 / 视频 / 图文
- time_range: 不限 / 一天内 / 一周内 / 半年内
- search_scope: 不限 / 已看过 / 未看过 / 已关注
- location: 不限 / 同城 / 附近
- count: 整数，用户明确说了数量就填，否则填 0（表示未指定）
- max_rounds: 整数，根据话题热度估算需要几轮才能找到足够内容
  - 冷门/垂直话题（如某小众软件、小城市攻略）：4～6 轮
  - 中等热度话题（如某款产品评测、某城市美食）：2～4 轮
  - 热门话题（如热播剧、流行穿搭）：1～2 轮
  - 最大不超过 8
- filter_prompt: 一句话说明对内容的要求
- first_keyword: 第一个搜索关键词，需符合小红书用户的真实搜索习惯：
  - 优先使用小红书常见表达，如"xx测评"、"xx避坑"、"xx攻略"、"xx推荐"、"xx好用吗"
  - 结合网络流行词、口语化表达，如"平替"、"好物"、"宝藏"、"yyds"、"绝绝子"、"种草"
  - 品牌/产品用全称或常用缩写（如"雅诗兰黛"而非"estee lauder"）
  - 避免过于书面化或正式的词汇（如"深度分析"→"深度测评"，"使用指南"→"使用教程"）
  - 关键词不宜过长，2-6个字为佳，多词组合用空格隔开（如"claude code 教程"）

规则：
- "最新"/"近期" → sort=最新，time_range=一周内
- "比较新的"/"新的"（非精确最新，只是希望内容不太旧）→ sort=最新，time_range=半年内，
  并在 filter_prompt 末尾追加"【时效限制：优先15天内，内容价值高可接受1个月内，超过1个月的拒绝】"
- "最火"/"热门" → sort=最多点赞
- "最新"+"最火" → sort=最多点赞，time_range=一周内
- "今天" → time_range=一天内
- sort 和 time_range 独立，可同时生效

用户说："{user_query}"

只返回 JSON：
{{
  "first_keyword": "关键词",
  "count": 0,
  "max_rounds": 3,
  "sort": "综合",
  "note_type": "不限",
  "time_range": "不限",
  "search_scope": "不限",
  "location": "不限",
  "filter_prompt": "内容筛选要求"
}}"""

        params = self._llm_call(prompt, temperature=0.1)
        print('\n[意图解析]')
        for k, v in params.items():
            print(f'  {k}: {v}')
        return params

    # ── 主入口 ────────────────────────────────────────────────────────

    def run(self, user_query: str) -> list[dict]:
        intent        = self.parse_intent(user_query)
        need          = intent.get('count', 5)
        sort          = intent.get('sort', '综合')
        note_type     = intent.get('note_type', '不限')
        time_range    = intent.get('time_range', '不限')
        search_scope  = intent.get('search_scope', '不限')
        location      = intent.get('location', '不限')
        filter_prompt = intent.get('filter_prompt', '')
        current_kw    = intent.get('first_keyword', user_query)

        raw_count = intent.get('count', 0)
        count_specified = raw_count and raw_count > 0
        need      = raw_count if count_specified else 5
        max_rounds = min(int(intent.get('max_rounds', 3)), 8)

        self._seen_ids = set()
        self._global_seen_ids = set()
        self._active = True
        self._collecting = False
        results: list[dict] = []
        used_keywords: list[str] = []

        print(f'\n[XHS Agent] 目标 {need} 条')

        with sync_playwright() as p:
            context = p.chromium.launch_persistent_context(
                user_data_dir=self.browser_data_dir,
                headless=False,
                viewport={'width': 1280, 'height': 720},
                locale='zh-CN',
                args=[
                    '--disable-blink-features=AutomationControlled',
                    '--disable-features=IsolateOrigins,site-per-process',
                ]
            )
            page = context.pages[0] if context.pages else context.new_page()
            page.on('response', self._on_response_search)
            page.on('response', self._on_response_detail)

            # 登录检查
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

            for round_num in range(max_rounds):
                if len(results) >= need:
                    break

                print(f'\n{"="*55}')
                print(f'轮次 {round_num+1} | 关键词: {current_kw} | 已有: {len(results)}/{need}')
                print('='*55)

                used_keywords.append(current_kw)
                self._pending_cards = []
                clicked_this_round: list[dict] = []
                click_queue: set[str] = set()
                scored_buffer: list[dict] = []
                id_to_card: dict[str, dict] = {}
                SCORE_BATCH = 5
                no_new_scrolls = 0

                # 进入搜索页
                page.goto(
                    f'https://www.xiaohongshu.com/search_result?keyword={current_kw}',
                    wait_until='domcontentloaded'
                )
                page.wait_for_timeout(3000)
                self._apply_filter(page, sort, note_type, time_range, search_scope, location)

                for scroll_step in range(20):
                    if len(results) + len(clicked_this_round) >= need:
                        break

                    # 1. 先处理当前已拦截到的 pending_cards
                    stop_scroll = False
                    if self._pending_cards:
                        for c in self._pending_cards:
                            id_to_card[c['id']] = c
                        scored_buffer.extend(self._pending_cards)
                        self._pending_cards = []
                        no_new_scrolls = 0
                    else:
                        no_new_scrolls += 1
                        if no_new_scrolls >= 3:
                            if scored_buffer:
                                r = self._llm_score_cards(
                                    scored_buffer, user_query, filter_prompt,
                                    already_have=len(results) + len(clicked_this_round),
                                    need=need, sort=sort, time_range=time_range,
                                    existing_results=results
                                )
                                click_queue.update(r['ids'])
                                scored_buffer = []
                                sort, time_range, changed = self._apply_score_filter_changes(
                                    page, r, sort, time_range, note_type, search_scope, location)
                                if changed:
                                    id_to_card.clear()
                                    click_queue.clear()
                            print('  连续3次无新卡片，停止滚动')
                            stop_scroll = True

                    # 2. 达到批量阈值 → 打分，LLM 同时决定是否继续滚动
                    if len(scored_buffer) >= SCORE_BATCH:
                        r = self._llm_score_cards(
                            scored_buffer, user_query, filter_prompt,
                            already_have=len(results) + len(clicked_this_round),
                            need=need, sort=sort, time_range=time_range,
                            existing_results=results
                        )
                        click_queue.update(r['ids'])
                        scored_buffer = []
                        sort, time_range, changed = self._apply_score_filter_changes(
                            page, r, sort, time_range, note_type, search_scope, location)
                        if changed:
                            id_to_card.clear()
                            click_queue.clear()
                        elif r['stop_scroll']:
                            stop_scroll = True

                    # 3. 点击当前 DOM 里 click_queue 中的卡片（此时页面在顶部/当前位置，卡片可见）
                    if click_queue:
                        visible_ids = self._mark_visible_cards(page)
                        to_click_now = click_queue & visible_ids
                        for card_id in list(to_click_now):
                            card = id_to_card.get(card_id)
                            if not card:
                                click_queue.discard(card_id)
                                continue
                            print(f'  点击: {card["title"][:40]}')
                            ok = self._click_card(page, card)
                            click_queue.discard(card_id)
                            if ok:
                                clicked_this_round.append(card)
                                print(f'  正文: {"有" if card["content"] else "无"}（{len(card["content"])} 字）')
                            page.wait_for_timeout(random.randint(300, 600))
                            if len(results) + len(clicked_this_round) >= need:
                                break

                    # 4. stop_scroll 时，退出前再检查一次（处理 no_new_scrolls 触发的情况）
                    if stop_scroll:
                        break

                    # 5. 滚动，触发下一批 API 响应
                    page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
                    page.wait_for_timeout(random.randint(1000, 1500))

                    if self._check_captcha(page):
                        self._wait_for_captcha(page)

                # ── 本轮结束，LLM 评估 ──
                if not clicked_this_round:
                    print('本轮未点击任何帖子，LLM 给出下一关键词')
                    decision = self._llm_evaluate(
                        user_query=user_query,
                        filter_prompt=filter_prompt,
                        new_posts=[],
                        existing_results=results,
                        need=need,
                        used_keywords=used_keywords,
                        current_sort=sort,
                        current_time_range=time_range,
                        count_specified=count_specified,
                    )
                else:
                    decision = self._llm_evaluate(
                        user_query=user_query,
                        filter_prompt=filter_prompt,
                        new_posts=clicked_this_round,
                        existing_results=results,
                        need=need,
                        used_keywords=used_keywords,
                        current_sort=sort,
                        current_time_range=time_range,
                        count_specified=count_specified,
                    )

                accepted_ids = set(decision.get('accepted_ids', []))
                accepted     = [c for c in clicked_this_round if c['id'] in accepted_ids]
                results.extend(accepted)
                print(f'本轮接受 {len(accepted)} 条，累计 {len(results)}/{need}')

                if decision.get('satisfied') or len(results) >= need:
                    print('\n[Agent] 已满足需求，退出')
                    break

                next_kw = decision.get('next_keyword', '').strip()
                if not next_kw:
                    print('[Agent] LLM 未给出下一关键词，退出')
                    break
                current_kw = next_kw

                # 应用 LLM 建议的筛选条件调整
                next_sort = decision.get('next_sort')
                next_time_range = decision.get('next_time_range')
                if next_sort and next_sort in FILTER_COORDS.get('sort', {}):
                    print(f'  [筛选调整] sort: {sort} → {next_sort}')
                    sort = next_sort
                if next_time_range and next_time_range in FILTER_COORDS.get('time', {}):
                    print(f'  [筛选调整] time_range: {time_range} → {next_time_range}')
                    time_range = next_time_range

            self._active = False
            context.close()

        print(f'\n[完成] 返回 {len(results[:need])} 条')
        return results[:need]


# ── 独立运行 ──────────────────────────────────────────────────────────

def main():
    api_key = os.environ.get('DEEPSEEK_API_KEY', '')
    if not api_key:
        print('未找到 DEEPSEEK_API_KEY，请在 .env 文件中设置')
        return

    tool = XHSAgentTool(deepseek_api_key=api_key)

    print('=' * 60)
    print('小红书 Agent Tool')
    print('=' * 60)
    user_query = input('\n请输入你的搜索需求: ').strip()
    if not user_query:
        return

    posts = tool.run(user_query)

    output_file = 'xhs_agent_result.json'
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(posts, f, ensure_ascii=False, indent=2)
    print(f'\n已保存到 {output_file}')

    print('\n预览:')
    for i, p in enumerate(posts, 1):
        print(f'\n{i}. {p["title"]}')
        print(f'   作者: {p["author"]}  发布: {p["publishedTime"]}')
        print(f'   点赞: {p["likes"]}  评论: {p["comments"]}  收藏: {p["collects"]}')
        if p['content']:
            print(f'   正文: {p["content"][:100]}...')
        if p['tags']:
            print(f'   标签: {", ".join(p["tags"][:5])}')


if __name__ == '__main__':
    main()
