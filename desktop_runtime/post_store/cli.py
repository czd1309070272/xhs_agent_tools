from __future__ import annotations

import json
import sys
from pathlib import Path

from .repository import (
    create_daily_report,
    delete_xhs_account,
    delete_posts,
    finish_scheduled_task_run,
    get_daily_report,
    get_posts_by_report,
    list_xhs_accounts,
    list_daily_reports,
    list_scheduled_tasks,
    load_posts,
    set_active_xhs_account,
    start_scheduled_task_run,
    upsert_scheduled_task,
    upsert_xhs_account,
)


def _require_path(args: list[str], index: int, error_message: str) -> Path:
    if len(args) <= index:
        raise SystemExit(error_message)
    return Path(args[index])


def _load_post_ids(raw_post_ids: str) -> list[str]:
    post_ids = json.loads(raw_post_ids)
    if not isinstance(post_ids, list):
        raise SystemExit("post_ids must be a JSON array")
    return post_ids


def _load_json_object(raw_payload: str) -> dict:
    payload = json.loads(raw_payload)
    if not isinstance(payload, dict):
        raise SystemExit("payload must be a JSON object")
    return payload


def dump_posts() -> None:
    json.dump(load_posts(), sys.stdout, ensure_ascii=False)


def dump_posts_file(args: list[str]) -> None:
    output_file = _require_path(args, 2, "output file path is required")
    output_file.write_text(
        json.dumps(load_posts(), ensure_ascii=False),
        encoding="utf-8",
    )


def delete_posts_command(args: list[str]) -> None:
    raw_post_ids = args[2] if len(args) > 2 else "[]"
    json.dump({"deletedCount": delete_posts(_load_post_ids(raw_post_ids))}, sys.stdout, ensure_ascii=False)


def delete_posts_file(args: list[str]) -> None:
    input_file = _require_path(args, 2, "input and output file paths are required")
    output_file = _require_path(args, 3, "input and output file paths are required")
    post_ids = _load_post_ids(input_file.read_text(encoding="utf-8"))
    output_file.write_text(
        json.dumps({"deletedCount": delete_posts(post_ids)}, ensure_ascii=False),
        encoding="utf-8",
    )


def dump_scheduled_tasks() -> None:
    json.dump(list_scheduled_tasks(), sys.stdout, ensure_ascii=False)


def dump_scheduled_tasks_file(args: list[str]) -> None:
    output_file = _require_path(args, 2, "output file path is required")
    output_file.write_text(
        json.dumps(list_scheduled_tasks(), ensure_ascii=False),
        encoding="utf-8",
    )


def upsert_scheduled_task_file(args: list[str]) -> None:
    input_file = _require_path(args, 2, "input and output file paths are required")
    output_file = _require_path(args, 3, "input and output file paths are required")
    payload = _load_json_object(input_file.read_text(encoding="utf-8"))
    output_file.write_text(
        json.dumps(upsert_scheduled_task(payload), ensure_ascii=False),
        encoding="utf-8",
    )


def start_scheduled_task_run_file(args: list[str]) -> None:
    input_file = _require_path(args, 2, "input and output file paths are required")
    output_file = _require_path(args, 3, "input and output file paths are required")
    payload = _load_json_object(input_file.read_text(encoding="utf-8"))
    output_file.write_text(
        json.dumps(start_scheduled_task_run(payload), ensure_ascii=False),
        encoding="utf-8",
    )


def finish_scheduled_task_run_file(args: list[str]) -> None:
    input_file = _require_path(args, 2, "input and output file paths are required")
    output_file = _require_path(args, 3, "input and output file paths are required")
    payload = _load_json_object(input_file.read_text(encoding="utf-8"))
    output_file.write_text(
        json.dumps(finish_scheduled_task_run(payload), ensure_ascii=False),
        encoding="utf-8",
    )


def generate_daily_report_file(args: list[str]) -> None:
    """生成每日报告的 CLI 命令"""
    input_file = _require_path(args, 2, "input and output file paths are required")
    output_file = _require_path(args, 3, "input and output file paths are required")
    payload = _load_json_object(input_file.read_text(encoding="utf-8"))

    # 导入报告生成器
    from .report_generator import prepare_llm_input, build_analysis_prompt, parse_llm_response, _parse_interaction_count
    from datetime import datetime
    import sys

    run_id = payload.get("runId", "")
    task_id = payload.get("taskId", "")
    task_name = payload.get("taskName", "每日任务")
    query = payload.get("query", "")

    if not run_id or not task_id:
        raise SystemExit("runId and taskId are required")

    # 获取本次新增的帖子
    all_posts = load_posts()

    # 如果 payload 中指定了 postIds，则只使用这些帖子
    specified_post_ids = payload.get("postIds", [])

    print(f"[DEBUG] 收到 {len(specified_post_ids)} 个 postIds", file=sys.stderr)
    print(f"[DEBUG] 数据库中共有 {len(all_posts)} 个帖子", file=sys.stderr)

    if specified_post_ids:
        posts = [p for p in all_posts if p.get("id") in specified_post_ids]
        print(f"[DEBUG] 匹配到 {len(posts)} 个帖子", file=sys.stderr)
    else:
        # 否则取最新的帖子
        posts = all_posts[:50]
        print(f"[DEBUG] 未指定 postIds，使用最新 {len(posts)} 个帖子", file=sys.stderr)

    report_date = datetime.now().strftime("%Y-%m-%d")

    if not posts:
        # 没有帖子，创建一个空报告
        print("[DEBUG] 没有帖子，创建空报告", file=sys.stderr)
        result = create_daily_report({
            "runId": run_id,
            "taskId": task_id,
            "reportDate": report_date,
            "title": f"{task_name} - {report_date}",
            "summary": "本次未找到新增帖子。",
            "totalPosts": 0,
            "status": "done",
            "postIds": [],
            "highlightedPosts": [],
        })
        output_file.write_text(
            json.dumps(result, ensure_ascii=False),
            encoding="utf-8",
        )
        return

    # 准备 LLM 输入
    task_info = {
        "name": task_name,
        "query": query,
        "report_date": report_date,
    }
    llm_input = prepare_llm_input(posts, task_info)
    prompt = build_analysis_prompt(llm_input)

    print(f"[DEBUG] 准备调用 LLM 生成报告", file=sys.stderr)

    # 调用 LLM 生成报告
    try:
        from pathlib import Path as PathLib
        import os

        # 读取 AI 配置
        ai_config_path = PathLib.cwd() / "ai_settings.json"
        if ai_config_path.exists():
            ai_config = json.loads(ai_config_path.read_text(encoding="utf-8"))
        else:
            ai_config = {}

        base_url = ai_config.get("baseUrl") or os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
        api_key = ai_config.get("apiKey") or os.getenv("DEEPSEEK_API_KEY", "")
        model = ai_config.get("model") or os.getenv("DEEPSEEK_MODEL", "deepseek-chat")

        if not api_key:
            raise ValueError("AI API key not configured")

        print(f"[DEBUG] 调用 LLM: {base_url} / {model}", file=sys.stderr)

        # 调用 OpenAI 兼容接口
        import requests

        response = requests.post(
            f"{base_url.rstrip('/')}/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "messages": [
                    {"role": "user", "content": prompt}
                ],
                "temperature": 0.7,
            },
            timeout=60,
        )
        response.raise_for_status()

        llm_response = response.json()
        summary_text = llm_response["choices"][0]["message"]["content"]
        print(f"[DEBUG] LLM 调用成功", file=sys.stderr)

    except Exception as e:
        # LLM 调用失败，生成一个简单的报告
        print(f"[DEBUG] LLM 调用失败: {str(e)}", file=sys.stderr)
        summary_text = f"""## 📊 数据概览
- 新增帖子：{len(posts)} 条
- 平均互动：点赞 {llm_input['statistics']['avg_likes']} / 评论 {llm_input['statistics']['avg_comments']} / 收藏 {llm_input['statistics']['avg_collects']}

## ⚠️ 报告生成失败
由于 LLM 调用失败，无法生成详细分析。错误信息：{str(e)}

请检查 AI 配置或稍后重试。"""

    # 解析 LLM 响应
    parsed = parse_llm_response(summary_text)

    # 提取高亮帖子（前5条高互动）
    post_ids = [p.get("id") for p in posts if p.get("id")]

    # 按点赞数排序
    sorted_posts = sorted(
        posts,
        key=lambda p: _parse_interaction_count(p.get("likes", "0")),
        reverse=True
    )

    highlighted = [
        {"postId": p.get("id"), "reason": "高互动内容"}
        for p in sorted_posts[:5]
        if p.get("id")
    ]

    print(f"[DEBUG] 创建报告: {len(post_ids)} 个帖子, {len(highlighted)} 个高亮", file=sys.stderr)

    # 创建报告
    result = create_daily_report({
        "runId": run_id,
        "taskId": task_id,
        "reportDate": report_date,
        "title": f"{task_name} - {report_date}",
        "summary": parsed["summary"],
        "totalPosts": len(posts),
        "status": "done",
        "postIds": post_ids,
        "highlightedPosts": highlighted,
    })

    print(f"[DEBUG] 报告创建成功: {result.get('reportId')}", file=sys.stderr)

    output_file.write_text(
        json.dumps(result, ensure_ascii=False),
        encoding="utf-8",
    )


def list_daily_reports_file(args: list[str]) -> None:
    """列出所有报告"""
    output_file = _require_path(args, 2, "output file path is required")
    output_file.write_text(
        json.dumps(list_daily_reports(), ensure_ascii=False),
        encoding="utf-8",
    )


def get_daily_report_file(args: list[str]) -> None:
    """获取单个报告详情"""
    input_file = _require_path(args, 2, "input and output file paths are required")
    output_file = _require_path(args, 3, "input and output file paths are required")
    payload = _load_json_object(input_file.read_text(encoding="utf-8"))
    report_id = payload.get("reportId", "")

    result = get_daily_report(report_id)
    output_file.write_text(
        json.dumps(result, ensure_ascii=False),
        encoding="utf-8",
    )


def get_posts_by_report_file(args: list[str]) -> None:
    """获取报告关联的帖子"""
    input_file = _require_path(args, 2, "input and output file paths are required")
    output_file = _require_path(args, 3, "input and output file paths are required")
    payload = _load_json_object(input_file.read_text(encoding="utf-8"))
    report_id = payload.get("reportId", "")

    result = get_posts_by_report(report_id)
    output_file.write_text(
        json.dumps(result, ensure_ascii=False),
        encoding="utf-8",
    )


def list_xhs_accounts_file(args: list[str]) -> None:
    output_file = _require_path(args, 2, "output file path is required")
    output_file.write_text(
        json.dumps(list_xhs_accounts(), ensure_ascii=False),
        encoding="utf-8",
    )


def upsert_xhs_account_file(args: list[str]) -> None:
    input_file = _require_path(args, 2, "input and output file paths are required")
    output_file = _require_path(args, 3, "input and output file paths are required")
    payload = _load_json_object(input_file.read_text(encoding="utf-8"))
    output_file.write_text(
        json.dumps(upsert_xhs_account(payload), ensure_ascii=False),
        encoding="utf-8",
    )


def set_active_xhs_account_file(args: list[str]) -> None:
    input_file = _require_path(args, 2, "input and output file paths are required")
    output_file = _require_path(args, 3, "input and output file paths are required")
    payload = _load_json_object(input_file.read_text(encoding="utf-8"))
    result = set_active_xhs_account(payload.get("accountId", ""))
    output_file.write_text(
        json.dumps(result, ensure_ascii=False),
        encoding="utf-8",
    )


def delete_xhs_account_file(args: list[str]) -> None:
    input_file = _require_path(args, 2, "input and output file paths are required")
    output_file = _require_path(args, 3, "input and output file paths are required")
    payload = _load_json_object(input_file.read_text(encoding="utf-8"))
    result = delete_xhs_account(payload.get("accountId", ""))
    output_file.write_text(
        json.dumps(result, ensure_ascii=False),
        encoding="utf-8",
    )


def main() -> None:
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    if command == "dump-posts":
        dump_posts()
        return
    if command == "dump-posts-file":
        dump_posts_file(sys.argv)
        return
    if command == "delete-posts":
        delete_posts_command(sys.argv)
        return
    if command == "delete-posts-file":
        delete_posts_file(sys.argv)
        return
    if command == "dump-scheduled-tasks":
        dump_scheduled_tasks()
        return
    if command == "dump-scheduled-tasks-file":
        dump_scheduled_tasks_file(sys.argv)
        return
    if command == "upsert-scheduled-task-file":
        upsert_scheduled_task_file(sys.argv)
        return
    if command == "start-scheduled-task-run-file":
        start_scheduled_task_run_file(sys.argv)
        return
    if command == "finish-scheduled-task-run-file":
        finish_scheduled_task_run_file(sys.argv)
        return
    if command == "generate-daily-report-file":
        generate_daily_report_file(sys.argv)
        return
    if command == "list-daily-reports-file":
        list_daily_reports_file(sys.argv)
        return
    if command == "get-daily-report-file":
        get_daily_report_file(sys.argv)
        return
    if command == "get-posts-by-report-file":
        get_posts_by_report_file(sys.argv)
        return
    if command == "list-xhs-accounts-file":
        list_xhs_accounts_file(sys.argv)
        return
    if command == "upsert-xhs-account-file":
        upsert_xhs_account_file(sys.argv)
        return
    if command == "set-active-xhs-account-file":
        set_active_xhs_account_file(sys.argv)
        return
    if command == "delete-xhs-account-file":
        delete_xhs_account_file(sys.argv)
        return

    raise SystemExit(f"Unsupported command: {command or '<empty>'}")


if __name__ == "__main__":
    main()
