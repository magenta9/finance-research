from __future__ import annotations

from .utils import _normalize_query


def _symbol_from_ts_code(ts_code: str) -> tuple[str, str, str | None, str]:
    code, _, suffix = ts_code.partition(".")
    normalized_suffix = suffix.upper()

    if normalized_suffix == "HK":
        return f"{code}.HK", "HK", "HKEX", "HKD"
    if normalized_suffix == "SH":
        return code, "A", "SSE", "CNY"
    if normalized_suffix == "SZ":
        return code, "A", "SZSE", "CNY"
    if normalized_suffix == "BJ":
        return code, "A", "BSE", "CNY"
    return code or ts_code, "A", normalized_suffix or None, "CNY"


def _resolve_ts_code(symbol: str, market: str | None) -> str:
    stripped = symbol.strip().upper()
    if "." in stripped:
        return stripped
    if market == "HK":
        return f"{stripped.zfill(5)}.HK"
    if len(stripped) == 6 and stripped.isdigit():
        if stripped[0] in ("6", "5", "9") or stripped.startswith("11"):
            return f"{stripped}.SH"
        if stripped[0] in ("0", "1", "2", "3"):
            return f"{stripped}.SZ"
        if stripped[0] in ("4", "8"):
            return f"{stripped}.BJ"
    return stripped


def _metadata_ts_code(asset_metadata: dict[str, object] | None) -> str | None:
    if asset_metadata is None:
        return None
    value = asset_metadata.get("tsCode")
    if not isinstance(value, str):
        return None
    normalized = value.strip().upper()
    return normalized or None


def _metadata_ts_code_asset(asset_metadata: dict[str, object] | None) -> str | None:
    if asset_metadata is None:
        return None
    value = asset_metadata.get("tsCodeAsset")
    if not isinstance(value, str):
        return None
    normalized = value.strip().upper()
    return normalized if normalized in {"E", "FD", "FT", "I"} else None


def _metadata_string(asset_metadata: dict[str, object] | None, key: str) -> str | None:
    if asset_metadata is None:
        return None
    value = asset_metadata.get(key)
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _is_futures_metadata(asset_metadata: dict[str, object] | None) -> bool:
    if asset_metadata is None:
        return False
    return (
        _metadata_ts_code_asset(asset_metadata) == "FT"
        or _metadata_string(asset_metadata, "instrumentType") == "futures"
    )


def _infer_pro_bar_asset(ts_code: str) -> str:
    code, _, suffix = ts_code.strip().upper().partition(".")
    if suffix in {"CNI", "CSI", "MSCI", "OTH", "SW"}:
        return "I"
    if suffix in {"SH", "SZ"} and code.startswith(
        ("15", "16", "50", "51", "52", "56", "58")
    ):
        return "FD"
    if (suffix == "SH" and code.startswith("000")) or (
        suffix == "SZ" and code.startswith("399")
    ):
        return "I"
    return "E"


def _classify_asset(name: str, ts_code: str) -> str:
    lowered = _normalize_query(name)
    if any(token in lowered for token in ("债", "bond")):
        return "fixed_income"
    if any(token in lowered for token in ("黄金", "商品", "commodity")):
        return "commodity"
    return "equity"
