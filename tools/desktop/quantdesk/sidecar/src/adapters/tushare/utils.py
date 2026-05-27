from __future__ import annotations

from datetime import datetime
import unicodedata
from typing import Any


def _normalize_query(value: str) -> str:
    return unicodedata.normalize("NFKC", value).strip().lower()


def _safe_float(value: Any) -> float | None:
    if value is None:
        return None

    try:
        if value != value:
            return None
    except Exception:
        return None

    try:
        return float(value)
    except Exception:
        return None


def _format_trade_date(value: Any) -> str | None:
    text = str(value).strip()
    if not text:
        return None
    if len(text) == 8 and text.isdigit():
        return f"{text[:4]}-{text[4:6]}-{text[6:8]}"
    try:
        return datetime.fromisoformat(text).date().isoformat()
    except ValueError:
        return None


def _compact_date(value: str) -> str:
    return value.replace("-", "")
