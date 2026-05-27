from __future__ import annotations

from datetime import date, datetime, timezone
import unicodedata
from typing import Any


def _normalize_query(value: str) -> str:
    return "".join(unicodedata.normalize("NFKC", str(value)).split()).lower()


def _clean_text(value: Any) -> str:
    return " ".join(str(value).split()).strip()


def _normalize_symbol(value: Any) -> str:
    text = _clean_text(value)
    lowered = text.lower()
    if lowered.startswith(("sh", "sz")):
        text = text[2:]

    digits = "".join(ch for ch in text if ch.isdigit())
    if len(digits) == 6:
        return digits

    return text


def _classify_fund(name: str, fund_type: str | None = None) -> tuple[str, str]:
    name_lower = _normalize_query(name)
    type_lower = _normalize_query(fund_type or "")

    if any(kw in type_lower for kw in ("货币", "现金")) or any(
        kw in name_lower for kw in ("货币", "现金", "日利")
    ):
        return ("A", "cash")

    if any(kw in type_lower for kw in ("债券", "固收")) or any(
        kw in name_lower
        for kw in ("国债", "债券", "信用债", "利率债", "政金债", "城投债", "可转债")
    ):
        return ("BOND", "fixed_income")

    if any(kw in type_lower for kw in ("商品", "能源", "资源")) or any(
        kw in name_lower
        for kw in ("黄金", "白银", "原油", "豆粕", "有色", "能源化工", "铜", "铝")
    ):
        return ("COMMODITY", "commodity")

    if "reit" in name_lower or "不动产" in name_lower:
        return ("A", "alternative")

    return ("A", "equity")


def _classify_etf(name: str, fund_type: str | None = None) -> tuple[str, str]:
    return _classify_fund(name, fund_type)


def _infer_underlying_market(name: str) -> dict[str, str]:
    if any(kw in name for kw in ("纳指", "纳斯达克", "标普", "道琼斯", "美国", "美股")):
        return {"underlyingMarket": "US"}
    if any(kw in name for kw in ("恒生", "港股", "香港")):
        return {"underlyingMarket": "HK"}
    return {}


def _normalize_date(value: Any) -> str:
    return str(value).replace("/", "-")[:10]


def _normalize_issue_date(value: Any) -> str | None:
    if value is None:
        return None

    if isinstance(value, date):
        return value.isoformat()

    if isinstance(value, (int, float)):
        if value <= 0:
            return None

        timestamp = float(value)
        if timestamp > 1_000_000_000_000:
            timestamp /= 1000

        try:
            return datetime.fromtimestamp(timestamp, tz=timezone.utc).date().isoformat()
        except (OverflowError, OSError, ValueError):
            return None

    text = _clean_text(value)
    if not text:
        return None

    if text.isdigit():
        if len(text) == 8:
            return f"{text[:4]}-{text[4:6]}-{text[6:8]}"
        if len(text) >= 10:
            return _normalize_issue_date(int(text))

    normalized = text.replace("/", "-")
    for separator in ("T", " "):
        if separator in normalized:
            normalized = normalized.split(separator, 1)[0]
            break

    if len(normalized) >= 10:
        candidate = normalized[:10]
        try:
            return date.fromisoformat(candidate).isoformat()
        except ValueError:
            return None

    return None


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


def _find_column(columns: list[str], aliases: tuple[str, ...]) -> str | None:
    normalized = {str(column).strip().lower(): str(column) for column in columns}

    for alias in aliases:
        match = normalized.get(alias.lower())
        if match:
            return match

    for column in columns:
        column_text = str(column)
        if any(alias.lower() in column_text.lower() for alias in aliases):
            return column_text

    return None


def _sort_by_date(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(rows, key=lambda row: str(row["date"]))