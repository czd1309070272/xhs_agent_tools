from pathlib import Path
import sys

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from xhs_agent import FILTER_COORDS, XHSAgentTool, main, resolve_llm_config_from_env

load_dotenv()


if __name__ == '__main__':
    main()
