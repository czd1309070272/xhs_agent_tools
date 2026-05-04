import os

from dotenv import load_dotenv

from .constants import (
    DEFAULT_DEEPSEEK_BASE_URL,
    DEFAULT_DEEPSEEK_MODEL,
    DEFAULT_OPENAI_BASE_URL,
    DEFAULT_OPENAI_MODEL,
)

load_dotenv()


def resolve_llm_config_from_env() -> dict:
    openai_api_key = os.environ.get('OPENAI_API_KEY', '').strip()
    deepseek_api_key = os.environ.get('DEEPSEEK_API_KEY', '').strip()
    openai_base_url = os.environ.get('OPENAI_BASE_URL', '').strip()
    openai_model = os.environ.get('OPENAI_MODEL', '').strip()
    deepseek_model = os.environ.get('DEEPSEEK_MODEL', '').strip()

    prefers_deepseek_fallback = (not openai_api_key) and bool(deepseek_api_key)
    api_key = openai_api_key or deepseek_api_key
    base_url = openai_base_url or (
        DEFAULT_DEEPSEEK_BASE_URL if prefers_deepseek_fallback else DEFAULT_OPENAI_BASE_URL
    )
    model = openai_model or deepseek_model or (
        DEFAULT_DEEPSEEK_MODEL if prefers_deepseek_fallback else DEFAULT_OPENAI_MODEL
    )
    return {
        'api_key': api_key,
        'base_url': base_url,
        'model': model,
    }
