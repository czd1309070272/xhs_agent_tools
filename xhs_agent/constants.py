FILTER_COORDS = {
    'sort': {
        '综合': (844, 197),
        '最新': (952, 197),
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
        '不限': (876, 432),
        '一天内': (960, 421),
        '一周内': (1068, 421),
        '半年内': (1176, 421),
    },
    'range': {
        '不限': (876, 519),
        '已看过': (960, 508),
        '未看过': (1068, 508),
        '已关注': (1176, 508),
    },
    'location': {
        '不限': (844, 595),
        '同城': (952, 595),
        '附近': (1060, 595),
    },
}

FILTER_BTN = (1204, 108)
CLOSE_PANEL = (600, 400)

DETAIL_URL_KEYWORDS = ['/feed', '/note/', 'web/v1/note', 'web/v2/note']
DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'
DEFAULT_OPENAI_MODEL = 'gpt-4.1-mini'
DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com'
DEFAULT_DEEPSEEK_MODEL = 'deepseek-chat'
SORT_OPTIONS = {'综合', '最新', '最多点赞', '最多评论', '最多收藏'}
TIME_RANGE_OPTIONS = {'不限', '一天内', '一周内', '半年内'}
NOTE_TYPE_OPTIONS = {'不限', '视频', '图文'}
SEARCH_SCOPE_OPTIONS = {'不限', '已看过', '未看过', '已关注'}
LOCATION_OPTIONS = {'不限', '同城', '附近'}
INTENT_TYPE_OPTIONS = {'visual', 'content', 'mixed'}
RECENCY_PREFERENCE_OPTIONS = {'strict', 'prefer_recent', 'none'}
