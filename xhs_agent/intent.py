import json

from .constants import (
    INTENT_TYPE_OPTIONS,
    LOCATION_OPTIONS,
    NOTE_TYPE_OPTIONS,
    RECENCY_PREFERENCE_OPTIONS,
    SEARCH_SCOPE_OPTIONS,
    SORT_OPTIONS,
    TIME_RANGE_OPTIONS,
)
from .utils import as_bool, normalize_choice, normalize_count


def classify_intent(tool, user_query: str) -> dict:
    prompt = f"""你是小红书搜索意图分类器，只做分类，不生成关键词，不生成筛选参数。

请根据用户需求返回这些字段：
- intent_type: visual / content / mixed
- wants_many_images: true / false
- wants_recency: strict / prefer_recent / none
- user_sort_explicit: true / false
- explicit_sort: 综合 / 最新 / 最多点赞 / 最多评论 / 最多收藏 / null
- count: 整数，用户明确说了数量就填，否则填 0

分类规则：
- visual：用户主要看图片效果或审美结果，如美女图、写真、穿搭图、头像、壁纸、家装效果图、出片参考
- content：用户主要看信息价值，如教程、攻略、测评、经验、推荐、避坑、科普
- mixed：用户同时明显要求信息价值和图片展示，如“图多的教程”“带步骤图的攻略”
- wants_many_images：用户提到“图多、多图、配图多、照片多、步骤图”等时设为 true
- wants_recency:
  - strict：用户明确说“最新、最近、今天、近期”
  - prefer_recent：用户说“比较新、新的”，但不是严格最新
  - none：没有明确时效偏好
- user_sort_explicit:
  - 只要用户明确表达了排序倾向，就设为 true，例如“热门的”“点赞高的”“最新的”“不要热门”
  - 如果能直接映射为系统排序值，再填 explicit_sort；否则 explicit_sort 返回 null

用户说："{user_query}"

只返回 JSON：
{{
  "intent_type": "content",
  "wants_many_images": false,
  "wants_recency": "none",
  "user_sort_explicit": false,
  "explicit_sort": null,
  "count": 0
}}"""

    raw = tool._llm_call(prompt, temperature=0.1)
    intent_context = {
        'intent_type': normalize_choice(raw.get('intent_type'), INTENT_TYPE_OPTIONS, 'content'),
        'wants_many_images': as_bool(raw.get('wants_many_images')),
        'wants_recency': normalize_choice(raw.get('wants_recency'), RECENCY_PREFERENCE_OPTIONS, 'none'),
        'user_sort_explicit': as_bool(raw.get('user_sort_explicit')),
        'explicit_sort': normalize_choice(raw.get('explicit_sort'), SORT_OPTIONS, ''),
        'count': normalize_count(raw.get('count', 0)),
    }
    print('\n[意图分类]')
    for key, value in intent_context.items():
        print(f'  {key}: {value}')
    return intent_context


def build_search_plan(tool, user_query: str, intent_context: dict) -> dict:
    prompt = f"""你是小红书搜索计划助手，根据已经完成的意图分类结果，生成搜索参数。

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

已完成的意图分类结果：
{json.dumps(intent_context, ensure_ascii=False, indent=2)}

要求：
- 必须尊重上面的分类结果，不要重新发明一个意图
- 如果 intent_type=visual，优先生成适合看图需求的小红书关键词
- 如果 wants_many_images=true，filter_prompt 里要明确强调多图优先
- 如果 wants_recency=prefer_recent，filter_prompt 里保留时效限制说明
- count 直接使用分类结果里的数值，不要自行改大改小

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

    params = tool._llm_call(prompt, temperature=0.1)
    return {
        'first_keyword': str(params.get('first_keyword') or user_query).strip() or user_query,
        'count': intent_context.get('count', 0),
        'max_rounds': min(max(normalize_count(params.get('max_rounds', 3)) or 3, 1), 8),
        'sort': normalize_choice(params.get('sort'), SORT_OPTIONS, '综合'),
        'note_type': normalize_choice(params.get('note_type'), NOTE_TYPE_OPTIONS, '不限'),
        'time_range': normalize_choice(params.get('time_range'), TIME_RANGE_OPTIONS, '不限'),
        'search_scope': normalize_choice(params.get('search_scope'), SEARCH_SCOPE_OPTIONS, '不限'),
        'location': normalize_choice(params.get('location'), LOCATION_OPTIONS, '不限'),
        'filter_prompt': str(params.get('filter_prompt') or '').strip(),
    }


def append_filter_prompt(base_prompt: str, extra_prompt: str) -> str:
    base_prompt = (base_prompt or '').strip()
    extra_prompt = (extra_prompt or '').strip()
    if not extra_prompt or extra_prompt in base_prompt:
        return base_prompt
    if not base_prompt:
        return extra_prompt
    return f'{base_prompt}；{extra_prompt}'


def apply_intent_rules(user_query: str, plan: dict, intent_context: dict) -> dict:
    merged = dict(plan)
    merged['intent_context'] = dict(intent_context)

    intent_type = intent_context.get('intent_type', 'content')
    wants_many_images = bool(intent_context.get('wants_many_images'))
    wants_recency = intent_context.get('wants_recency', 'none')
    user_sort_explicit = bool(intent_context.get('user_sort_explicit'))
    explicit_sort = intent_context.get('explicit_sort', '')

    if user_sort_explicit and explicit_sort in SORT_OPTIONS:
        merged['sort'] = explicit_sort
    elif not user_sort_explicit and intent_type == 'visual':
        merged['sort'] = '最多点赞'

    if wants_recency == 'strict':
        merged['time_range'] = '一天内' if '今天' in user_query else '一周内'
        if not user_sort_explicit:
            merged['sort'] = '最新'
    elif wants_recency == 'prefer_recent':
        if merged.get('time_range') == '不限':
            merged['time_range'] = '半年内'
        if not user_sort_explicit and intent_type != 'visual':
            merged['sort'] = '最新'
        merged['filter_prompt'] = append_filter_prompt(
            merged.get('filter_prompt', ''),
            '【时效限制：优先15天内，内容价值高可接受1个月内，超过1个月的拒绝】'
        )

    if intent_type == 'visual':
        merged['filter_prompt'] = append_filter_prompt(
            merged.get('filter_prompt', ''),
            '【视觉策略：优先高点赞、高收藏、多图帖子，正文短不直接降权】'
        )

    if wants_many_images:
        if merged.get('note_type') == '不限':
            merged['note_type'] = '图文'
        merged['filter_prompt'] = append_filter_prompt(
            merged.get('filter_prompt', ''),
            '【多图优先：在主题相关前提下，优先图片数量更多的帖子】'
        )

    return merged
