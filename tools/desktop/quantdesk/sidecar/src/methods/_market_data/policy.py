from __future__ import annotations

from typing import Any


MARKET_POLICY_KEYS = {"US", "HK", "A", "BOND", "COMMODITY"}


def market_policy_key(market: str | None) -> str:
    if market in MARKET_POLICY_KEYS:
        return market
    return "default"


def search_provider_ids(policy: dict[str, Any], market: str | None) -> list[str]:
    return policy["searchProviderOrder"][market_policy_key(market)]


def filter_provider_ids(
    provider_ids: list[str], enabled_sources: list[str]
) -> list[str]:
    enabled = set(enabled_sources)
    return [provider_id for provider_id in provider_ids if provider_id in enabled]


def price_provider_ids(
    policy: dict[str, Any], symbol: str, market: str | None
) -> list[str]:
    market_key = market_policy_key(market)
    is_domestic_fund_symbol = symbol.isdigit() and len(symbol) == 6
    if market_key == "default" and is_domestic_fund_symbol:
        return policy["priceProviderOrder"]["digitSymbolFallback"]
    if market_key in ("BOND", "COMMODITY") and is_domestic_fund_symbol:
        return policy["priceProviderOrder"]["A"]
    return policy["priceProviderOrder"][market_key]


def fx_provider_ids(policy: dict[str, Any]) -> list[str]:
    return policy["fxProviderOrder"]


def source_priority(
    policy: dict[str, Any], source: str, *, market: str | None, kind: str
) -> float:
    root = source.split("-", 1)[0]
    if kind == "price":
        base_priority = policy["sourcePriorityWeights"]["price"][
            market_policy_key(market)
        ].get(root, 0)
    else:
        base_priority = policy["sourcePriorityWeights"]["fx"].get(root, 0)

    if "derived" in source:
        base_priority -= policy["derivedSourcePenalty"]

    return float(base_priority)


def has_only_lower_priority_price_providers(
    policy: dict[str, Any],
    provider_id: str,
    remaining_provider_ids: list[str],
    market: str | None,
) -> bool:
    current_priority = source_priority(policy, provider_id, market=market, kind="price")
    return all(
        source_priority(policy, next_provider_id, market=market, kind="price")
        < current_priority
        for next_provider_id in remaining_provider_ids
    )
