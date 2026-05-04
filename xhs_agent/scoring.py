import json
from datetime import date

from .utils import normalize_count


def llm_call(tool, prompt: str, temperature: float = 0.2) -> dict:
    for attempt in range(3):
        try:
            response = tool.llm.chat.completions.create(
                model=tool.model,
                messages=[{'role': 'user', 'content': prompt}],
                temperature=temperature,
            )
            raw = response.choices[0].message.content.strip().strip('`')
            if raw.startswith('json'):
                raw = raw[4:]
            result = json.loads(raw)
            return result if isinstance(result, dict) else {}
        except Exception as error:
            if attempt == 2:
                print(f'  [LLM错误] 连续3次失败: {error}')
                raise
            print(f'  [LLM重试] 第{attempt + 1}次失败: {error}')
    return {}


def llm_score_cards(tool, cards: list[dict], user_query: str, filter_prompt: str, already_have: int, need: int, sort: str = '综合', time_range: str = '不限', intent_context: dict | None = None, existing_results: list | None = None, strategy_mode: str = 'explore', coverage_plan: str = '') -> dict:
    intent_context = intent_context or {}
    still_need = need - already_have
    available_count = len(cards)
    if available_count <= 0:
        return {'ids': [], 'stop_scroll': False, 'next_sort': None, 'next_time_range': None, 'click_budget': 0}

    min_click = 1 if available_count == 1 else 2
    if intent_context.get('intent_type') == 'visual' or intent_context.get('wants_many_images'):
        max_click_cap = 6
    elif intent_context.get('intent_type') == 'mixed':
        max_click_cap = 5
    else:
        max_click_cap = 4
    max_click = min(max_click_cap, available_count)
    min_click = min(min_click, max_click)
    default_click = min(max(3, min_click), max_click)

    summary = [{
        'id': card['id'],
        'title': card['title'],
        'author': card['author'],
        'likes': card['likes'],
        'comments': card['comments'],
        'collects': card['collects'],
        'publishedTime': card['publishedTime'],
        'type': card['type'],
        'image_count': card.get('image_count', len(card.get('images', []))),
    } for card in cards]

    existing_hint = ''
    if existing_results:
        existing_summary = [
            f'《{post["title"]}》' + (f' 标签: {", ".join(post["tags"][:5])}' if post.get('tags') else '')
            for post in existing_results
        ]
        existing_hint = f"""
已收录内容（选帖时避免同质化，优先覆盖还未涉及的角度）：
{chr(10).join(f"- {item}" for item in existing_summary)}
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

    intent_hint = ''
    if intent_context.get('intent_type') == 'visual':
        intent_hint += """
视觉导向需求规则：
- 当前需求主要看图片效果，你看不到图片内容本身，因此要把点赞、收藏、image_count 当作主要代理信号
- 只要主题相关，不要因为正文短就直接降权
- 当多个候选都相关时，优先高点赞、高收藏、多图帖子"""
    elif intent_context.get('intent_type') == 'mixed':
        intent_hint += """
混合需求规则：
- 当前需求既看内容也看展示效果
- 先保证主题相关，再综合正文价值、互动数据和 image_count 选帖"""

    if intent_context.get('wants_many_images'):
        intent_hint += """
多图优先规则：
- 用户明确偏好多图
- 在主题相关前提下，image_count 更高的帖子优先级更高
- 不要选图片特别少的帖子去挤占点击名额"""

    strategy_hint = ''
    if strategy_mode == 'focus':
        strategy_hint += """
本轮策略：focus
- 当前应偏收敛，优先点最像、最稳、最有把握的候选
- 若候选质量明显很高，可适当缩小 click_budget"""
    elif strategy_mode == 'diversify':
        strategy_hint += f"""
本轮策略：diversify
- 当前应优先补充不同角度，避免和已有结果同质化
- 下一批点击候选应覆盖更分散的子话题
- 覆盖规划：{coverage_plan or '优先补齐未覆盖角度'}"""
    elif strategy_mode == 'recover':
        strategy_hint += f"""
本轮策略：recover
- 上一轮结果不理想，这一轮要更偏探索和补救
- 可适当放大 click_budget，优先尝试更宽松、更近邻的话题
- 覆盖规划：{coverage_plan or '优先救回相关结果'}"""
    else:
        strategy_hint += f"""
本轮策略：explore
- 当前应保留探索性，不要过早收窄候选
- 覆盖规划：{coverage_plan or '优先多看几个潜在方向'}"""

    prompt = f"""你是小红书内容筛选助手。

用户需求：{user_query}
{f'筛选标准：{filter_prompt}' if filter_prompt else ''}
目前已有 {already_have} 条，还需要 {still_need} 条。
当前筛选：sort={sort}，time_range={time_range}
{existing_hint}{time_hint}{intent_hint}{strategy_hint}
以下是刚加载出来的帖子：
{json.dumps(summary, ensure_ascii=False, indent=2)}

任务1：决定本轮点击预算，并选出最值得点进去看完整内容的帖子。
规则：
- 先决定 click_budget，再按这个数量给出 ids
- click_budget 必须在 {min_click} 到 {max_click} 之间
- 如果标题信号弱、用户要求图多、偏视觉导向、或当前还缺 {still_need} 条较多，可把 click_budget 往大了给
- 如果这一批候选很强、主题非常聚焦，也可以用较小的 click_budget
- 若候选帖子数量足够，ids 尽量与 click_budget 一致，不能明显少报
- 相关度判断：帖子是否与用户需求的主题/领域相关，不要求标题完全匹配关键词
  - 例如用户要"claude code skills"，标题含 Claude、AI编程、MCP、提示词工程等都算相关
  - 宁可选主题相近的，也不要因为没有完整关键词就排除
- 按相关度排序，取前 click_budget 名，宁可选主题相近的，也不要过早留空
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
{{"click_budget": {default_click}, "ids": ["id1", "id2"], "stop_scroll": false, "next_sort": null, "next_time_range": null}}"""

    result = llm_call(tool, prompt, temperature=0.2)
    requested_click_budget = normalize_count(result.get('click_budget', default_click)) or default_click
    actual_click_budget = max(min(requested_click_budget, max_click), min_click)
    raw_ids = result.get('ids', [])
    ids: list[str] = []
    for item in raw_ids:
        card_id = str(item).strip()
        if card_id and card_id not in ids:
            ids.append(card_id)
    if len(ids) > actual_click_budget:
        ids = ids[:actual_click_budget]
    stop = result.get('stop_scroll', False)
    next_sort = result.get('next_sort')
    next_time_range = result.get('next_time_range')
    message = (
        f'  [LLM打分] {len(cards)} 条中选 {len(ids)} 条'
        f'，click_budget={requested_click_budget}->{actual_click_budget}'
        f'，stop_scroll={stop}'
    )
    if next_sort:
        message += f'，建议换sort→{next_sort}'
    if next_time_range:
        message += f'，建议换time_range→{next_time_range}'
    print(message)
    return {
        'ids': ids,
        'stop_scroll': stop,
        'next_sort': next_sort,
        'next_time_range': next_time_range,
        'click_budget': actual_click_budget,
    }


def llm_evaluate(tool, user_query: str, filter_prompt: str, new_posts: list[dict], existing_results: list[dict], need: int, used_keywords: list[str], current_sort: str, current_time_range: str, intent_context: dict | None = None, count_specified: bool = True) -> dict:
    intent_context = intent_context or {}
    posts_summary = [{
        'id': post['id'],
        'title': post['title'],
        'content': post['content'][:300] if post['content'] else '（未获取到正文）',
        'likes': post['likes'],
        'collects': post['collects'],
        'image_count': post.get('image_count', len(post.get('images', []))),
        'publishedTime': post.get('publishedTime', ''),
    } for post in new_posts]

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
            f'《{post["title"]}》：{post["content"][:80] if post["content"] else "无正文"}'
            for post in existing_results
        ]
        existing_hint = f"""
已收录内容（下一关键词应覆盖还未涉及的角度，避免与这些重复）：
{chr(10).join(f"- {item}" for item in existing_summary)}
"""

    satisfied_rule = (
        f"- 用户明确指定了数量（{need} 条），达到该数量才能将 satisfied 设为 true"
        if count_specified else
        f"- 用户未指定数量，上限 {need} 条；已有内容能全面覆盖用户需求的主要角度时即可将 satisfied 设为 true，不必凑满 {need} 条"
    )

    intent_hint = ''
    if intent_context.get('intent_type') == 'visual':
        intent_hint += """
- 当前需求是视觉导向型，AI看不到图片内容本身
- 因此接受帖子时，要优先参考点赞、收藏、image_count 等代理信号
- 正文短不是硬伤，只要主题相关、互动高、多图即可接受"""
    elif intent_context.get('intent_type') == 'mixed':
        intent_hint += """
- 当前需求是图文混合型
- 既要看主题和内容价值，也要兼顾互动和 image_count"""

    if intent_context.get('wants_many_images'):
        intent_hint += """
- 用户明确要求图多，image_count 是高优先级指标
- 主题相关时，多图帖子优先进入 accepted_ids"""

    strategy_hint = """
可选 strategy_mode：
- explore：继续探索更多近邻方向，扩大候选面
- focus：当前方向已经对了，下一轮更聚焦高质量结果
- diversify：已有结果开始同质化，下一轮优先补不同角度
- recover：本轮结果质量差或命中不足，下一轮优先补救
"""

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
{intent_hint}

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
   - 如果用户明确指定了数量，且“已有结果 + 本轮 accepted_ids”还不到 {need} 条，那么：
     - satisfied 必须为 false
     - next_keyword 必须返回非空字符串
4. 同时决定下一轮策略：
   - 返回 strategy_mode，取值只能是 explore / focus / diversify / recover
   - 返回 coverage_plan，用一句中文描述下一轮还缺哪些角度或应该补什么内容

{strategy_hint}

只返回 JSON：
{{
  "accepted_ids": ["id列表"],
  "satisfied": true或false,
  "next_keyword": "下一关键词",
  "strategy_mode": "explore",
  "coverage_plan": "下一轮要补的角度",
  "next_sort": null或"新sort值",
  "next_time_range": null或"新time_range值",
  "reason": "简短说明"
}}"""

    decision = llm_call(tool, prompt, temperature=0.2)
    print(
        f'  [LLM评估] 接受 {len(decision.get("accepted_ids", []))} 条 | '
        f'satisfied={decision.get("satisfied")} | '
        f'strategy={decision.get("strategy_mode", "")} | '
        f'{decision.get("reason", "")}'
    )
    if decision.get('coverage_plan'):
        print(f'  [覆盖规划] {decision.get("coverage_plan")}')
    if decision.get('next_sort') or decision.get('next_time_range'):
        print(f'  [LLM评估] 调整筛选: sort={decision.get("next_sort")} time_range={decision.get("next_time_range")}')
    return decision
