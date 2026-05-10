from __future__ import annotations

import json
import uuid
from datetime import datetime
from pathlib import Path

from .db import get_connection, utc_now_iso
from .schema import ensure_schema
from .serializers import deserialize_post, normalize_post_id


def upsert_posts(posts: list[dict], source_query: str | None = None, db_path: Path | None = None) -> None:
    connection = get_connection(db_path)
    ensure_schema(connection)
    now = utc_now_iso()

    with connection:
        for index, post in enumerate(posts):
            post_id = normalize_post_id(post, index)
            payload = json.dumps(post, ensure_ascii=False)
            existing_created_at = connection.execute(
                "SELECT created_at FROM posts WHERE post_id = ?",
                (post_id,),
            ).fetchone()
            created_at = existing_created_at["created_at"] if existing_created_at else now

            connection.execute(
                """
                INSERT INTO posts (
                    post_id, url, title, post_type, author, author_id,
                    published_time, likes, comments, collects, shares,
                    content, source_query, raw_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(post_id) DO UPDATE SET
                    url = excluded.url,
                    title = excluded.title,
                    post_type = excluded.post_type,
                    author = excluded.author,
                    author_id = excluded.author_id,
                    published_time = excluded.published_time,
                    likes = excluded.likes,
                    comments = excluded.comments,
                    collects = excluded.collects,
                    shares = excluded.shares,
                    content = excluded.content,
                    source_query = excluded.source_query,
                    raw_json = excluded.raw_json,
                    updated_at = excluded.updated_at
                """,
                (
                    post_id,
                    post.get("url"),
                    post.get("title"),
                    post.get("type"),
                    post.get("author"),
                    post.get("author_id"),
                    post.get("publishedTime"),
                    post.get("likes"),
                    post.get("comments"),
                    post.get("collects"),
                    post.get("shares"),
                    post.get("content"),
                    source_query,
                    payload,
                    created_at,
                    now,
                ),
            )

            connection.execute("DELETE FROM post_images WHERE post_id = ?", (post_id,))
            connection.execute("DELETE FROM post_tags WHERE post_id = ?", (post_id,))

            for image_index, image_url in enumerate(post.get("images") or []):
                connection.execute(
                    "INSERT INTO post_images (post_id, image_index, image_url) VALUES (?, ?, ?)",
                    (post_id, image_index, image_url),
                )

            for tag_index, tag_text in enumerate(post.get("tags") or []):
                connection.execute(
                    "INSERT INTO post_tags (post_id, tag_index, tag_text) VALUES (?, ?, ?)",
                    (post_id, tag_index, tag_text),
                )

    connection.close()


def load_posts(db_path: Path | None = None) -> list[dict]:
    connection = get_connection(db_path)
    ensure_schema(connection)

    rows = connection.execute(
        """
        SELECT
            post_id, url, title, post_type, author, author_id,
            published_time, likes, comments, collects, shares,
            content, raw_json, created_at, updated_at
        FROM posts
        ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC
        """
    ).fetchall()

    images_by_post: dict[str, list[str]] = {}
    for row in connection.execute(
        "SELECT post_id, image_url FROM post_images ORDER BY post_id, image_index"
    ).fetchall():
        images_by_post.setdefault(row["post_id"], []).append(row["image_url"])

    tags_by_post: dict[str, list[str]] = {}
    for row in connection.execute(
        "SELECT post_id, tag_text FROM post_tags ORDER BY post_id, tag_index"
    ).fetchall():
        tags_by_post.setdefault(row["post_id"], []).append(row["tag_text"])

    posts = [
        deserialize_post(
            row,
            images_by_post.get(row["post_id"], []),
            tags_by_post.get(row["post_id"], []),
        )
        for row in rows
    ]

    connection.close()
    return posts


def delete_posts(post_ids: list[str], db_path: Path | None = None) -> int:
    normalized_ids = [str(post_id).strip() for post_id in post_ids if str(post_id).strip()]
    if not normalized_ids:
        return 0

    connection = get_connection(db_path)
    ensure_schema(connection)

    with connection:
        placeholders = ", ".join("?" for _ in normalized_ids)
        cursor = connection.execute(
            f"DELETE FROM posts WHERE post_id IN ({placeholders})",
            normalized_ids,
        )
        deleted_count = cursor.rowcount if cursor.rowcount is not None else 0

    connection.close()
    return max(0, deleted_count)


def _normalize_schedule_time(value: object) -> str:
    schedule_time = str(value or "").strip()
    try:
        return datetime.strptime(schedule_time, "%H:%M").strftime("%H:%M")
    except ValueError as error:
        raise ValueError("schedule_time must use HH:MM format") from error


def _deserialize_scheduled_task(row) -> dict:
    return {
        "taskId": row["task_id"],
        "name": row["name"],
        "query": row["query"],
        "scheduleType": row["schedule_type"],
        "scheduleTime": row["schedule_time"],
        "enabled": bool(row["enabled"]),
        "lastRunAt": row["last_run_at"],
        "lastRunStatus": row["last_run_status"],
        "lastRunSummary": row["last_run_summary"],
        "lastResultCount": row["last_result_count"],
        "lastRunTriggerType": row["last_run_trigger_type"],
        "lastScheduledFor": row["last_scheduled_for"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def list_scheduled_tasks(db_path: Path | None = None) -> list[dict]:
    connection = get_connection(db_path)
    ensure_schema(connection)
    rows = connection.execute(
        """
        SELECT
            task_id, name, query, schedule_type, schedule_time, enabled,
            last_run_at, last_run_status, last_run_summary, last_result_count,
            last_run_trigger_type, last_scheduled_for, created_at, updated_at
        FROM scheduled_tasks
        ORDER BY enabled DESC, datetime(updated_at) DESC, datetime(created_at) DESC
        """
    ).fetchall()
    tasks = [_deserialize_scheduled_task(row) for row in rows]
    connection.close()
    return tasks


def get_scheduled_task(task_id: str, db_path: Path | None = None) -> dict | None:
    normalized_task_id = str(task_id or "").strip()
    if not normalized_task_id:
        return None

    connection = get_connection(db_path)
    ensure_schema(connection)
    row = connection.execute(
        """
        SELECT
            task_id, name, query, schedule_type, schedule_time, enabled,
            last_run_at, last_run_status, last_run_summary, last_result_count,
            last_run_trigger_type, last_scheduled_for, created_at, updated_at
        FROM scheduled_tasks
        WHERE task_id = ?
        """,
        (normalized_task_id,),
    ).fetchone()
    connection.close()
    return _deserialize_scheduled_task(row) if row else None


def upsert_scheduled_task(task_payload: dict, db_path: Path | None = None) -> dict:
    if not isinstance(task_payload, dict):
        raise ValueError("task payload must be a JSON object")

    task_id = str(task_payload.get("taskId") or "").strip() or uuid.uuid4().hex
    query = str(task_payload.get("query") or "").strip()
    if not query:
        raise ValueError("query is required")

    provided_name = str(task_payload.get("name") or "").strip()
    name = provided_name or query[:32] or "每日任务"
    schedule_type = str(task_payload.get("scheduleType") or "daily").strip() or "daily"
    if schedule_type != "daily":
        raise ValueError("only daily schedule is supported")

    schedule_time = _normalize_schedule_time(task_payload.get("scheduleTime") or "09:30")
    enabled = 1 if bool(task_payload.get("enabled", True)) else 0
    now = utc_now_iso()

    connection = get_connection(db_path)
    ensure_schema(connection)
    existing = connection.execute(
        """
        SELECT
            created_at, last_run_at, last_run_status, last_run_summary,
            last_result_count, last_run_trigger_type, last_scheduled_for
        FROM scheduled_tasks
        WHERE task_id = ?
        """,
        (task_id,),
    ).fetchone()
    created_at = existing["created_at"] if existing else now

    with connection:
        connection.execute(
            """
            INSERT INTO scheduled_tasks (
                task_id, name, query, schedule_type, schedule_time, enabled,
                last_run_at, last_run_status, last_run_summary, last_result_count,
                last_run_trigger_type, last_scheduled_for, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(task_id) DO UPDATE SET
                name = excluded.name,
                query = excluded.query,
                schedule_type = excluded.schedule_type,
                schedule_time = excluded.schedule_time,
                enabled = excluded.enabled,
                updated_at = excluded.updated_at
            """,
            (
                task_id,
                name,
                query,
                schedule_type,
                schedule_time,
                enabled,
                existing["last_run_at"] if existing else None,
                existing["last_run_status"] if existing else None,
                existing["last_run_summary"] if existing else None,
                existing["last_result_count"] if existing else None,
                existing["last_run_trigger_type"] if existing else None,
                existing["last_scheduled_for"] if existing else None,
                created_at,
                now,
            ),
        )

    connection.close()
    task = get_scheduled_task(task_id, db_path)
    if not task:
        raise RuntimeError("scheduled task save failed")
    return task


def start_scheduled_task_run(run_payload: dict, db_path: Path | None = None) -> dict:
    if not isinstance(run_payload, dict):
        raise ValueError("run payload must be a JSON object")

    task_id = str(run_payload.get("taskId") or "").strip()
    if not task_id:
        raise ValueError("taskId is required")

    trigger_type = str(run_payload.get("triggerType") or "scheduled").strip() or "scheduled"
    scheduled_for = str(run_payload.get("scheduledFor") or "").strip() or None
    started_at = str(run_payload.get("startedAt") or "").strip() or utc_now_iso()
    summary = str(run_payload.get("summary") or "").strip() or "任务已进入执行队列。"
    run_id = str(run_payload.get("runId") or "").strip() or uuid.uuid4().hex
    now = utc_now_iso()

    connection = get_connection(db_path)
    ensure_schema(connection)
    task = connection.execute(
        "SELECT task_id FROM scheduled_tasks WHERE task_id = ?",
        (task_id,),
    ).fetchone()
    if not task:
        connection.close()
        raise ValueError("scheduled task not found")

    with connection:
        connection.execute(
            """
            INSERT INTO scheduled_task_runs (
                run_id, task_id, trigger_type, scheduled_for, started_at,
                finished_at, status, result_count, summary, error_message,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                run_id,
                task_id,
                trigger_type,
                scheduled_for,
                started_at,
                None,
                "running",
                None,
                summary,
                None,
                now,
                now,
            ),
        )
        connection.execute(
            """
            UPDATE scheduled_tasks
            SET
                last_run_at = ?,
                last_run_status = ?,
                last_run_summary = ?,
                last_result_count = NULL,
                last_run_trigger_type = ?,
                last_scheduled_for = COALESCE(?, last_scheduled_for),
                updated_at = ?
            WHERE task_id = ?
            """,
            (
                started_at,
                "running",
                summary,
                trigger_type,
                scheduled_for,
                now,
                task_id,
            ),
        )

    connection.close()
    return {
        "runId": run_id,
        "taskId": task_id,
        "scheduledFor": scheduled_for,
        "startedAt": started_at,
        "triggerType": trigger_type,
    }


def finish_scheduled_task_run(run_payload: dict, db_path: Path | None = None) -> dict:
    if not isinstance(run_payload, dict):
        raise ValueError("run payload must be a JSON object")

    task_id = str(run_payload.get("taskId") or "").strip()
    run_id = str(run_payload.get("runId") or "").strip()
    status = str(run_payload.get("status") or "").strip() or "completed"
    finished_at = str(run_payload.get("finishedAt") or "").strip() or utc_now_iso()
    trigger_type = str(run_payload.get("triggerType") or "").strip() or "scheduled"
    summary = str(run_payload.get("summary") or "").strip() or "任务执行结束。"
    error_message = str(run_payload.get("errorMessage") or "").strip() or None
    result_count = run_payload.get("resultCount")
    normalized_result_count = int(result_count) if result_count is not None else None
    now = utc_now_iso()

    if not task_id or not run_id:
        raise ValueError("taskId and runId are required")

    connection = get_connection(db_path)
    ensure_schema(connection)
    with connection:
        connection.execute(
            """
            UPDATE scheduled_task_runs
            SET
                finished_at = ?,
                status = ?,
                result_count = ?,
                summary = ?,
                error_message = ?,
                updated_at = ?
            WHERE run_id = ? AND task_id = ?
            """,
            (
                finished_at,
                status,
                normalized_result_count,
                summary,
                error_message,
                now,
                run_id,
                task_id,
            ),
        )
        connection.execute(
            """
            UPDATE scheduled_tasks
            SET
                last_run_at = ?,
                last_run_status = ?,
                last_run_summary = ?,
                last_result_count = ?,
                last_run_trigger_type = ?,
                updated_at = ?
            WHERE task_id = ?
            """,
            (
                finished_at,
                status,
                summary,
                normalized_result_count,
                trigger_type,
                now,
                task_id,
            ),
        )

    connection.close()
    task = get_scheduled_task(task_id, db_path)
    if not task:
        raise RuntimeError("scheduled task update failed")
    return task


def create_daily_report(report_payload: dict, db_path: Path | None = None) -> dict:
    """创建每日报告并关联帖子"""
    if not isinstance(report_payload, dict):
        raise ValueError("report payload must be a JSON object")

    report_id = str(report_payload.get("reportId") or "").strip() or uuid.uuid4().hex
    run_id = str(report_payload.get("runId") or "").strip()
    task_id = str(report_payload.get("taskId") or "").strip()
    report_date = str(report_payload.get("reportDate") or "").strip()
    title = str(report_payload.get("title") or "").strip()
    summary = str(report_payload.get("summary") or "").strip()
    total_posts = int(report_payload.get("totalPosts") or 0)
    status = str(report_payload.get("status") or "done").strip()
    post_ids = report_payload.get("postIds") or []
    highlighted_posts = report_payload.get("highlightedPosts") or []

    if not run_id or not task_id or not report_date:
        raise ValueError("runId, taskId, and reportDate are required")

    now = utc_now_iso()
    connection = get_connection(db_path)
    ensure_schema(connection)

    with connection:
        connection.execute(
            """
            INSERT INTO daily_reports (
                report_id, run_id, task_id, report_date, title, summary,
                total_posts, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (report_id, run_id, task_id, report_date, title, summary,
             total_posts, status, now, now),
        )

        for post_id in post_ids:
            is_highlighted = 1 if post_id in highlighted_posts else 0
            highlight_reason = None
            if is_highlighted:
                for hp in highlighted_posts:
                    if isinstance(hp, dict) and hp.get("postId") == post_id:
                        highlight_reason = hp.get("reason")
                        break

            connection.execute(
                """
                INSERT INTO report_posts (report_id, post_id, is_highlighted, highlight_reason)
                VALUES (?, ?, ?, ?)
                """,
                (report_id, post_id, is_highlighted, highlight_reason),
            )

    connection.close()
    return get_daily_report(report_id, db_path)


def get_daily_report(report_id: str, db_path: Path | None = None) -> dict | None:
    """获取单个报告详情"""
    normalized_report_id = str(report_id or "").strip()
    if not normalized_report_id:
        return None

    connection = get_connection(db_path)
    ensure_schema(connection)

    row = connection.execute(
        """
        SELECT
            report_id, run_id, task_id, report_date, title, summary,
            total_posts, status, created_at, updated_at
        FROM daily_reports
        WHERE report_id = ?
        """,
        (normalized_report_id,),
    ).fetchone()

    if not row:
        connection.close()
        return None

    post_rows = connection.execute(
        """
        SELECT post_id, is_highlighted, highlight_reason
        FROM report_posts
        WHERE report_id = ?
        ORDER BY is_highlighted DESC
        """,
        (normalized_report_id,),
    ).fetchall()

    connection.close()

    return {
        "reportId": row["report_id"],
        "runId": row["run_id"],
        "taskId": row["task_id"],
        "reportDate": row["report_date"],
        "title": row["title"],
        "summary": row["summary"],
        "totalPosts": row["total_posts"],
        "status": row["status"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "postIds": [r["post_id"] for r in post_rows],
        "highlightedPosts": [
            {"postId": r["post_id"], "reason": r["highlight_reason"]}
            for r in post_rows if r["is_highlighted"]
        ],
    }


def list_daily_reports(db_path: Path | None = None) -> list[dict]:
    """列出所有报告（按日期倒序）"""
    connection = get_connection(db_path)
    ensure_schema(connection)

    rows = connection.execute(
        """
        SELECT
            report_id, run_id, task_id, report_date, title, summary,
            total_posts, status, created_at, updated_at
        FROM daily_reports
        ORDER BY report_date DESC, datetime(created_at) DESC
        """
    ).fetchall()

    reports = []
    for row in rows:
        post_count = connection.execute(
            "SELECT COUNT(*) as cnt FROM report_posts WHERE report_id = ?",
            (row["report_id"],),
        ).fetchone()["cnt"]

        reports.append({
            "reportId": row["report_id"],
            "runId": row["run_id"],
            "taskId": row["task_id"],
            "reportDate": row["report_date"],
            "title": row["title"],
            "summary": row["summary"],
            "totalPosts": row["total_posts"],
            "status": row["status"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
            "linkedPostCount": post_count,
        })

    connection.close()
    return reports


def get_posts_by_report(report_id: str, db_path: Path | None = None) -> list[dict]:
    """获取报告关联的所有帖子"""
    normalized_report_id = str(report_id or "").strip()
    if not normalized_report_id:
        return []

    connection = get_connection(db_path)
    ensure_schema(connection)

    rows = connection.execute(
        """
        SELECT
            p.post_id, p.url, p.title, p.post_type, p.author, p.author_id,
            p.published_time, p.likes, p.comments, p.collects, p.shares,
            p.content, p.raw_json, p.created_at, p.updated_at,
            rp.is_highlighted, rp.highlight_reason
        FROM posts p
        INNER JOIN report_posts rp ON p.post_id = rp.post_id
        WHERE rp.report_id = ?
        ORDER BY rp.is_highlighted DESC, p.likes DESC
        """,
        (normalized_report_id,),
    ).fetchall()

    images_by_post: dict[str, list[str]] = {}
    for row in connection.execute(
        """
        SELECT pi.post_id, pi.image_url
        FROM post_images pi
        INNER JOIN report_posts rp ON pi.post_id = rp.post_id
        WHERE rp.report_id = ?
        ORDER BY pi.post_id, pi.image_index
        """,
        (normalized_report_id,),
    ).fetchall():
        images_by_post.setdefault(row["post_id"], []).append(row["image_url"])

    tags_by_post: dict[str, list[str]] = {}
    for row in connection.execute(
        """
        SELECT pt.post_id, pt.tag_text
        FROM post_tags pt
        INNER JOIN report_posts rp ON pt.post_id = rp.post_id
        WHERE rp.report_id = ?
        ORDER BY pt.post_id, pt.tag_index
        """,
        (normalized_report_id,),
    ).fetchall():
        tags_by_post.setdefault(row["post_id"], []).append(row["tag_text"])

    posts = []
    for row in rows:
        post = deserialize_post(
            row,
            images_by_post.get(row["post_id"], []),
            tags_by_post.get(row["post_id"], []),
        )
        post["isHighlighted"] = bool(row["is_highlighted"])
        post["highlightReason"] = row["highlight_reason"]
        posts.append(post)

    connection.close()
    return posts


def _deserialize_xhs_account(row, active_account_id: str | None = None) -> dict:
    return {
        "accountId": row["account_id"],
        "username": row["username"],
        "displayName": row["display_name"],
        "dataDirName": row["data_dir_name"],
        "isActive": row["account_id"] == active_account_id,
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def _get_active_xhs_account_id(connection) -> str:
    row = connection.execute(
        "SELECT active_account_id FROM xhs_account_state WHERE state_key = ?",
        ("main",),
    ).fetchone()
    return str(row["active_account_id"] or "") if row else ""


def list_xhs_accounts(db_path: Path | None = None) -> dict:
    connection = get_connection(db_path)
    ensure_schema(connection)
    active_account_id = _get_active_xhs_account_id(connection)
    rows = connection.execute(
        """
        SELECT account_id, username, display_name, data_dir_name, created_at, updated_at
        FROM xhs_accounts
        ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC
        """
    ).fetchall()
    accounts = [_deserialize_xhs_account(row, active_account_id) for row in rows]
    connection.close()
    if active_account_id and not any(account["accountId"] == active_account_id for account in accounts):
        active_account_id = ""
    return {
        "activeAccountId": active_account_id,
        "accounts": accounts,
    }


def upsert_xhs_account(account_payload: dict, db_path: Path | None = None) -> dict:
    if not isinstance(account_payload, dict):
        raise ValueError("account payload must be a JSON object")

    account_id = str(account_payload.get("accountId") or "").strip()
    username = str(account_payload.get("username") or account_id).strip()
    display_name = str(account_payload.get("displayName") or username).strip()
    data_dir_name = str(account_payload.get("dataDirName") or "").strip()
    set_active = bool(account_payload.get("setActive", True))
    if not account_id or not username or not data_dir_name:
        raise ValueError("accountId, username and dataDirName are required")

    now = utc_now_iso()
    connection = get_connection(db_path)
    ensure_schema(connection)
    existing = connection.execute(
        "SELECT created_at FROM xhs_accounts WHERE account_id = ?",
        (account_id,),
    ).fetchone()
    created_at = existing["created_at"] if existing else now

    with connection:
        connection.execute(
            """
            INSERT INTO xhs_accounts (
                account_id, username, display_name, data_dir_name, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(account_id) DO UPDATE SET
                username = excluded.username,
                display_name = excluded.display_name,
                data_dir_name = excluded.data_dir_name,
                updated_at = excluded.updated_at
            """,
            (account_id, username, display_name, data_dir_name, created_at, now),
        )
        if set_active:
            connection.execute(
                """
                INSERT INTO xhs_account_state (state_key, active_account_id, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(state_key) DO UPDATE SET
                    active_account_id = excluded.active_account_id,
                    updated_at = excluded.updated_at
                """,
                ("main", account_id, now),
            )

    active_account_id = _get_active_xhs_account_id(connection)
    row = connection.execute(
        """
        SELECT account_id, username, display_name, data_dir_name, created_at, updated_at
        FROM xhs_accounts
        WHERE account_id = ?
        """,
        (account_id,),
    ).fetchone()
    connection.close()
    if not row:
        raise RuntimeError("xhs account save failed")
    return _deserialize_xhs_account(row, active_account_id)


def set_active_xhs_account(account_id: str, db_path: Path | None = None) -> dict | None:
    normalized_account_id = str(account_id or "").strip()
    if not normalized_account_id:
        raise ValueError("accountId is required")

    now = utc_now_iso()
    connection = get_connection(db_path)
    ensure_schema(connection)
    row = connection.execute(
        """
        SELECT account_id, username, display_name, data_dir_name, created_at, updated_at
        FROM xhs_accounts
        WHERE account_id = ?
        """,
        (normalized_account_id,),
    ).fetchone()
    if not row:
        connection.close()
        return None

    with connection:
        connection.execute(
            """
            INSERT INTO xhs_account_state (state_key, active_account_id, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(state_key) DO UPDATE SET
                active_account_id = excluded.active_account_id,
                updated_at = excluded.updated_at
            """,
            ("main", normalized_account_id, now),
        )

    connection.close()
    return _deserialize_xhs_account(row, normalized_account_id)


def delete_xhs_account(account_id: str, db_path: Path | None = None) -> dict:
    normalized_account_id = str(account_id or "").strip()
    if not normalized_account_id:
        raise ValueError("accountId is required")

    now = utc_now_iso()
    connection = get_connection(db_path)
    ensure_schema(connection)
    with connection:
        connection.execute("DELETE FROM xhs_accounts WHERE account_id = ?", (normalized_account_id,))
        active_account_id = _get_active_xhs_account_id(connection)
        if active_account_id == normalized_account_id:
            next_row = connection.execute(
                """
                SELECT account_id FROM xhs_accounts
                ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC
                LIMIT 1
                """
            ).fetchone()
            next_active_id = next_row["account_id"] if next_row else None
            connection.execute(
                """
                INSERT INTO xhs_account_state (state_key, active_account_id, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(state_key) DO UPDATE SET
                    active_account_id = excluded.active_account_id,
                    updated_at = excluded.updated_at
                """,
                ("main", next_active_id, now),
            )
    connection.close()
    return list_xhs_accounts(db_path)
