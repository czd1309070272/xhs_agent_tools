from __future__ import annotations

import json
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
