import re


def as_bool(value) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        return value.strip().lower() in {'true', '1', 'yes', 'y'}
    return False


def normalize_choice(value, allowed: set[str], default: str) -> str:
    text = str(value).strip() if value is not None else ''
    return text if text in allowed else default


def normalize_count(value) -> int:
    try:
        return max(0, int(value))
    except Exception:
        return 0


def normalize_title_key(value: str) -> str:
    text = str(value or '').strip().lower()
    if not text:
        return ''
    return re.sub(r'[\W_]+', '', text, flags=re.UNICODE)
