from __future__ import annotations

PROVIDER_IDS = {
    "cninfo",
    "eastmoney_notice",
    "sse_disclosure",
    "hkexnews",
    "hsi_index_notices",
    "sec_edgar",
    "sec_efts",
}


def normalize_market(market: str | None) -> str | None:
    return market if market in {"A", "HK", "US"} else None


def announcement_provider_ids(policy: dict, market: str | None) -> list[str]:
    market_key = normalize_market(market) or "default"
    provider_ids = policy["announcementProviderOrder"].get(market_key, [])

    return [
        provider_id
        for provider_id in provider_ids
        if policy["providerStatus"].get(provider_id) == "enabled"
    ]


def filter_provider_ids(
    provider_ids: list[str], enabled_providers: list[str]
) -> list[str]:
    enabled = set(enabled_providers)
    return [
        provider_id
        for provider_id in provider_ids
        if provider_id in enabled and provider_id in PROVIDER_IDS
    ]


def source_priority(policy: dict, provider_id: str) -> float:
    value = policy["sourcePriorityWeights"].get(provider_id, 0)
    return float(value) if isinstance(value, (int, float)) else 0.0
