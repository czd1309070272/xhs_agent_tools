import json

from desktop_runtime.post_store import upsert_posts

from .config import resolve_llm_config_from_env
from .tool import XHSAgentTool


def main():
    llm_config = resolve_llm_config_from_env()
    if not llm_config['api_key']:
        print('未找到 OPENAI_API_KEY（兼容 DEEPSEEK_API_KEY），请在 .env 文件中设置')
        return

    tool = XHSAgentTool(
        api_key=llm_config['api_key'],
        base_url=llm_config['base_url'],
        model=llm_config['model'],
    )

    print('=' * 60)
    print('小红书 Agent Tool')
    print('=' * 60)
    user_query = input('\n请输入你的搜索需求: ').strip()
    if not user_query:
        return

    posts = tool.run(user_query)
    upsert_posts(posts, source_query=user_query)

    output_file = 'xhs_agent_result.json'
    with open(output_file, 'w', encoding='utf-8') as file:
        json.dump(posts, file, ensure_ascii=False, indent=2)
    print(f'\n已保存到 {output_file}')

    print('\n预览:')
    for index, post in enumerate(posts, 1):
        print(f'\n{index}. {post["title"]}')
        print(f'   作者: {post["author"]}  发布: {post["publishedTime"]}')
        print(f'   点赞: {post["likes"]}  评论: {post["comments"]}  收藏: {post["collects"]}')
        if post['content']:
            print(f'   正文: {post["content"][:100]}...')
        if post['tags']:
            print(f'   标签: {", ".join(post["tags"][:5])}')
