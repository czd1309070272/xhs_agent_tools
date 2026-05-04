from __future__ import annotations

import json
import sqlite3


def normalize_post_id(post: dict, fallback_index: int) -> str:
    return str(post.get("id") or post.get("url") or f"generated-{fallback_index}")


def build_fallback_post(row: sqlite3.Row) -> dict:
    return {
        "id": row["post_id"],
        "url": row["url"],
        "title": row["title"],
        "type": row["post_type"],
        "author": row["author"],
        "author_id": row["author_id"],
        "publishedTime": row["published_time"],
        "likes": row["likes"],
        "comments": row["comments"],
        "collects": row["collects"],
        "shares": row["shares"],
        "content": row["content"],
    }


def deserialize_post(row: sqlite3.Row, images: list[str], tags: list[str]) -> dict:
    try:
        post = json.loads(row["raw_json"])
    except json.JSONDecodeError:
        post = build_fallback_post(row)

    post["id"] = row["post_id"]
    post["url"] = row["url"]
    post["title"] = row["title"]
    post["type"] = row["post_type"]
    post["author"] = row["author"]
    post["author_id"] = row["author_id"]
    post["publishedTime"] = row["published_time"]
    post["likes"] = row["likes"]
    post["comments"] = row["comments"]
    post["collects"] = row["collects"]
    post["shares"] = row["shares"]
    post["content"] = row["content"]
    post["images"] = images
    post["tags"] = tags
    post["createdAt"] = row["created_at"]
    post["updatedAt"] = row["updated_at"]
    return post
