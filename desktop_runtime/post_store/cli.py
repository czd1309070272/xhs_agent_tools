from __future__ import annotations

import json
import sys
from pathlib import Path

from .repository import delete_posts, load_posts


def _require_path(args: list[str], index: int, error_message: str) -> Path:
    if len(args) <= index:
        raise SystemExit(error_message)
    return Path(args[index])


def _load_post_ids(raw_post_ids: str) -> list[str]:
    post_ids = json.loads(raw_post_ids)
    if not isinstance(post_ids, list):
        raise SystemExit("post_ids must be a JSON array")
    return post_ids


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

    raise SystemExit(f"Unsupported command: {command or '<empty>'}")


if __name__ == "__main__":
    main()
