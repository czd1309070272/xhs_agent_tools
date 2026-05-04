from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from desktop_runtime.post_store import delete_posts, load_posts, upsert_posts
from desktop_runtime.post_store.cli import main


if __name__ == "__main__":
    main()
