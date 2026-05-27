from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any


RESEARCH_PROVIDER_IDS = {"akshare", "tushare", "yfinance"}
NORTHBOUND_CAVEAT = "disclosure_policy_change_2024"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def today_iso() -> str:
    return date.today().isoformat()


def metadata_string(asset_metadata: dict[str, object] | None, key: str) -> str | None:
    value = (asset_metadata or {}).get(key)
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def is_a_market_fund_or_etf(
    symbol: str, asset_metadata: dict[str, object] | None
) -> bool:
    normalized_symbol = (
        symbol.strip().upper().replace(".SZ", "").replace(".SH", "").replace(".BJ", "")
    )
    if normalized_symbol.startswith(
        ("15", "16", "17", "18", "50", "51", "52", "56", "58")
    ):
        return True

    metadata_text = " ".join(
        text
        for text in (
            metadata_string(asset_metadata, "name"),
            metadata_string(asset_metadata, "assetName"),
            metadata_string(asset_metadata, "fundType"),
            metadata_string(asset_metadata, "assetType"),
            metadata_string(asset_metadata, "instrumentType"),
        )
        if text is not None
    ).lower()
    return any(
        keyword in metadata_text
        for keyword in ("etf", "基金", "qdii", "lof", "fof", "reit")
    )


def fund_facts_result(
    provider_id: str,
    symbol: str,
    market: str,
    asset_metadata: dict[str, object] | None,
    underlying_valuation: dict[str, Any] | None = None,
) -> dict[str, Any]:
    facts = {
        key: value
        for key, value in {
            "assetClass": metadata_string(asset_metadata, "assetClass"),
            "assetName": metadata_string(asset_metadata, "name")
            or metadata_string(asset_metadata, "assetName"),
            "fundType": metadata_string(asset_metadata, "fundType"),
            "issueDate": metadata_string(asset_metadata, "issueDate"),
            "underlyingMarket": metadata_string(asset_metadata, "underlyingMarket"),
        }.items()
        if value is not None
    }

    return {
        "asOf": today_iso(),
        "dataAgeDays": None,
        "market": market,
        "metrics": {
            "period": {"fiscalPeriod": None, "reportDate": None},
            "fundFacts": {
                "issuerStyleFundamentals": "asset_not_covered",
                **facts,
                **(
                    {"underlyingValuation": underlying_valuation}
                    if underlying_valuation is not None
                    else {}
                ),
            },
        },
        "qualityStatus": "degraded",
        "rowsUsed": 0,
        "symbol": symbol,
        "warnings": [
            f"Fund/ETF issuer-style fundamentals are not covered by {provider_id}; returning asset metadata facts instead.",
            "ETF/fund PE/PB requires an explicit underlying-index valuation source; do not infer it from issuer-style fundamentals.",
        ],
    }


def normalize_market(market: str | None) -> str | None:
    return market if market in {"A", "HK", "US", "BOND", "COMMODITY"} else None


def provider_order(
    order_map: dict[str, list[str]],
    provider_status: dict[str, str],
    market: str | None,
    enabled_providers: list[str] | None,
) -> list[str]:
    key = normalize_market(market) or "default"
    enabled = set(enabled_providers or RESEARCH_PROVIDER_IDS)
    return [
        provider_id
        for provider_id in order_map.get(key, [])
        if provider_id in enabled and provider_status.get(provider_id) == "enabled"
    ]


def classify_provider_error(error: Exception) -> str:
    message = str(error).lower()
    if any(
        token in message
        for token in (
            "permission",
            "权限",
            "积分",
            "token",
            "unauthorized",
            "forbidden",
        )
    ):
        return "permission"
    if any(token in message for token in ("rate", "429", "too many", "频率", "限频")):
        return "rate_limit"
    if any(
        token in message
        for token in ("column", "schema", "structure", "parse", "字段", "结构")
    ):
        return "parse"
    if any(
        token in message
        for token in ("timeout", "network", "connection", "http", "urlopen")
    ):
        return "network"
    return "unknown"


def disabled_until(hours: int) -> str:
    return (
        (datetime.now(timezone.utc) + timedelta(hours=hours))
        .isoformat()
        .replace("+00:00", "Z")
    )


def parse_date(value: Any) -> date | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%Y%m%d", "%Y/%m/%d"):
        try:
            return datetime.strptime(
                text[:10] if fmt == "%Y-%m-%d" else text, fmt
            ).date()
        except ValueError:
            continue
    return None


def data_age_days(report_date: str | None, as_of: str | None = None) -> int | None:
    parsed_report_date = parse_date(report_date)
    parsed_as_of = parse_date(as_of) or date.today()
    if parsed_report_date is None:
        return None
    return max(0, (parsed_as_of - parsed_report_date).days)


def provenance(
    *,
    kind: str,
    provider_id: str,
    quality_status: str,
    rows_used: int,
    symbol: str | None,
    warnings: list[str],
) -> dict[str, Any]:
    return {
        "fetchedAt": now_iso(),
        "providerIds": [provider_id],
        "qualityStatus": "pass" if quality_status == "available" else "warn",
        "rowsUsed": rows_used,
        "sourceId": f"{kind}:{provider_id}:{symbol or 'unknown'}",
        "warnings": warnings,
    }


def empty_fundamentals_result(
    *,
    attempted_sources: list[str],
    market: str | None,
    provider_errors: list[dict[str, Any]],
    symbol: str,
    warnings: list[str],
) -> dict[str, Any]:
    return {
        "asOf": None,
        "attemptedSources": attempted_sources,
        "dataAgeDays": None,
        "dataProvenance": [],
        "market": market,
        "metrics": {"period": {"fiscalPeriod": None, "reportDate": None}},
        "providerErrors": provider_errors,
        "qualityStatus": "unavailable",
        "symbol": symbol,
        "warnings": warnings,
    }


def empty_flow_result(
    *,
    attempted_sources: list[str],
    market: str | None,
    provider_errors: list[dict[str, Any]],
    symbol: str | None,
    warnings: list[str],
) -> dict[str, Any]:
    return {
        "asOf": None,
        "attemptedSources": attempted_sources,
        "dataProvenance": [],
        "market": market,
        "providerErrors": provider_errors,
        "qualityStatus": "unavailable",
        "signals": {},
        "symbol": symbol,
        "warnings": warnings,
    }


def dedupe(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result
