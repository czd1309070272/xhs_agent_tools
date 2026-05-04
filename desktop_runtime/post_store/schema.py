from __future__ import annotations

import sqlite3


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS posts (
    post_id TEXT PRIMARY KEY,
    url TEXT,
    title TEXT,
    post_type TEXT,
    author TEXT,
    author_id TEXT,
    published_time TEXT,
    likes TEXT,
    comments TEXT,
    collects TEXT,
    shares TEXT,
    content TEXT,
    source_query TEXT,
    raw_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS post_images (
    post_id TEXT NOT NULL,
    image_index INTEGER NOT NULL,
    image_url TEXT NOT NULL,
    PRIMARY KEY (post_id, image_index),
    FOREIGN KEY (post_id) REFERENCES posts(post_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS post_tags (
    post_id TEXT NOT NULL,
    tag_index INTEGER NOT NULL,
    tag_text TEXT NOT NULL,
    PRIMARY KEY (post_id, tag_index),
    FOREIGN KEY (post_id) REFERENCES posts(post_id) ON DELETE CASCADE
);
"""


def ensure_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(SCHEMA_SQL)
