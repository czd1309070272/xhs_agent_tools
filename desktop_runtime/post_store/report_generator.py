"""每日报告生成模块

负责从帖子数据生成专业的每日报告摘要。
"""

from __future__ import annotations

import json
from typing import Any


def prepare_llm_input(posts: list[dict], task_info: dict) -> dict:
    """准备输入给 LLM 的数据结构

    Args:
        posts: 本次新增的帖子列表
        task_info: 任务信息（任务名、查询关键词等）

    Returns:
        结构化的输入数据
    """
    # 提取关键统计数据
    total_posts = len(posts)

    # 计算平均互动数据
    total_likes = 0
    total_comments = 0
    total_collects = 0

    # 按类型分类
    type_counts = {}

    # 提取前 10 条高互动帖子（按点赞数排序）
    sorted_posts = sorted(
        posts,
        key=lambda p: _parse_interaction_count(p.get('likes', '0')),
        reverse=True
    )

    top_posts = []
    for post in sorted_posts[:10]:
        likes = _parse_interaction_count(post.get('likes', '0'))
        comments = _parse_interaction_count(post.get('comments', '0'))
        collects = _parse_interaction_count(post.get('collects', '0'))

        total_likes += likes
        total_comments += comments
        total_collects += collects

        post_type = post.get('type', 'unknown')
        type_counts[post_type] = type_counts.get(post_type, 0) + 1

        top_posts.append({
            'title': post.get('title', '无标题'),
            'author': post.get('author', '未知作者'),
            'likes': likes,
            'comments': comments,
            'collects': collects,
            'content_preview': (post.get('content') or '')[:200],
            'tags': post.get('tags', []),
            'post_type': post_type,
            'url': post.get('url', ''),
        })

    # 计算平均值
    avg_likes = total_likes // total_posts if total_posts > 0 else 0
    avg_comments = total_comments // total_posts if total_posts > 0 else 0
    avg_collects = total_collects // total_posts if total_posts > 0 else 0

    return {
        'task_name': task_info.get('name', '每日任务'),
        'query': task_info.get('query', ''),
        'report_date': task_info.get('report_date', ''),
        'statistics': {
            'total_posts': total_posts,
            'avg_likes': avg_likes,
            'avg_comments': avg_comments,
            'avg_collects': avg_collects,
            'type_distribution': type_counts,
        },
        'top_posts': top_posts,
    }


def build_analysis_prompt(input_data: dict) -> str:
    """构建专业的分析 prompt

    Args:
        input_data: prepare_llm_input 返回的结构化数据

    Returns:
        完整的 prompt 字符串
    """
    stats = input_data['statistics']
    top_posts = input_data['top_posts']

    # 构建帖子列表文本
    posts_text = []
    for i, post in enumerate(top_posts, 1):
        posts_text.append(
            f"{i}. **{post['title']}**\n"
            f"   - 作者：{post['author']}\n"
            f"   - 互动数据：👍 {_format_number(post['likes'])} / 💬 {_format_number(post['comments'])} / ⭐ {_format_number(post['collects'])}\n"
            f"   - 内容类型：{post['post_type']}\n"
            f"   - 标签：{', '.join(post['tags'][:5]) if post['tags'] else '无'}\n"
            f"   - 内容预览：{post['content_preview']}\n"
        )

    type_dist_text = ', '.join([f"{k} {v}条" for k, v in stats['type_distribution'].items()])

    prompt = f"""你是一位专业的小红书内容分析师，负责为用户生成每日内容报告。

## 任务背景
- 任务名称：{input_data['task_name']}
- 搜索关键词：{input_data['query']}
- 报告日期：{input_data['report_date']}

## 数据概览
- 新增帖子总数：{stats['total_posts']} 条
- 平均互动数据：点赞 {_format_number(stats['avg_likes'])} / 评论 {_format_number(stats['avg_comments'])} / 收藏 {_format_number(stats['avg_collects'])}
- 内容类型分布：{type_dist_text}

## 高互动帖子（按点赞数排序）

{''.join(posts_text)}

---

请基于以上数据，生成一份专业的每日内容分析报告。报告需要包含以下部分：

1. **📊 数据概览**：总结本次新增帖子的整体情况（数量、类型分布、平均互动水平）

2. **🔥 热门内容**：挑选 3-5 条最具代表性的高互动帖子，分析它们的核心亮点和用户反馈特征

3. **📈 趋势洞察**：基于帖子标题、标签、内容预览，分析当前的热门话题、用户关注点、内容趋势

4. **💡 内容建议**：为内容创作者提供可操作的建议（创作方向、话题选择、互动策略等）

## 输出要求
- 使用 Markdown 格式
- 语言专业但易懂，避免过度营销化的表达
- 数据引用准确，分析有理有据
- 每个部分控制在 3-5 个要点，避免冗长
- 如果数据量较少（<5条），适当调整分析深度，避免过度解读

请直接输出报告内容，不要添加额外的说明或前缀。"""

    return prompt


def parse_llm_response(response_text: str) -> dict:
    """解析 LLM 返回的报告内容

    Args:
        response_text: LLM 返回的 Markdown 文本

    Returns:
        包含 summary 和 metadata 的字典
    """
    # 清理可能的前后缀
    summary = response_text.strip()

    # 提取标题作为简短描述（用于列表展示）
    lines = summary.split('\n')
    title_line = ''
    for line in lines:
        if line.strip() and not line.startswith('#'):
            title_line = line.strip()[:100]
            break

    return {
        'summary': summary,
        'title_preview': title_line or '每日内容分析报告',
    }


def _parse_interaction_count(value: str | int) -> int:
    """解析互动数（支持 1.2k, 5.6w 等格式）"""
    if isinstance(value, int):
        return value

    if not isinstance(value, str):
        return 0

    value = value.strip().lower()
    if not value or value == '-':
        return 0

    # 移除可能的 + 号
    value = value.replace('+', '')

    # 处理 k (千) 和 w (万) 单位
    multiplier = 1
    if value.endswith('k'):
        multiplier = 1000
        value = value[:-1]
    elif value.endswith('w') or value.endswith('万'):
        multiplier = 10000
        value = value[:-1]

    try:
        return int(float(value) * multiplier)
    except (ValueError, TypeError):
        return 0


def _format_number(num: int) -> str:
    """格式化数字为易读形式"""
    if num >= 10000:
        return f"{num / 10000:.1f}w"
    elif num >= 1000:
        return f"{num / 1000:.1f}k"
    else:
        return str(num)
