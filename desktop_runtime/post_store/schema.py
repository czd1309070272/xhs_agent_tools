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

CREATE TABLE IF NOT EXISTS scheduled_tasks (
    task_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    query TEXT NOT NULL,
    schedule_type TEXT NOT NULL,
    schedule_time TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_run_at TEXT,
    last_run_status TEXT,
    last_run_summary TEXT,
    last_result_count INTEGER,
    last_run_trigger_type TEXT,
    last_scheduled_for TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scheduled_task_runs (
    run_id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    trigger_type TEXT NOT NULL,
    scheduled_for TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL,
    result_count INTEGER,
    summary TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (task_id) REFERENCES scheduled_tasks(task_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS daily_reports (
    report_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    report_date TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    total_posts INTEGER NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (run_id) REFERENCES scheduled_task_runs(run_id) ON DELETE CASCADE,
    FOREIGN KEY (task_id) REFERENCES scheduled_tasks(task_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS report_posts (
    report_id TEXT NOT NULL,
    post_id TEXT NOT NULL,
    is_highlighted INTEGER DEFAULT 0,
    highlight_reason TEXT,
    PRIMARY KEY (report_id, post_id),
    FOREIGN KEY (report_id) REFERENCES daily_reports(report_id) ON DELETE CASCADE,
    FOREIGN KEY (post_id) REFERENCES posts(post_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS xhs_accounts (
    account_id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    data_dir_name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS xhs_account_state (
    state_key TEXT PRIMARY KEY,
    active_account_id TEXT,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (active_account_id) REFERENCES xhs_accounts(account_id) ON DELETE SET NULL
);
"""


def ensure_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(SCHEMA_SQL)
