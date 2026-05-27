from __future__ import annotations

from collections.abc import Iterator
import json
from pathlib import Path
import shutil
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from contracts import (
    load_market_data_fixture,
    load_market_data_policy,
    load_news_catalyst_policy,
    load_research_provider_policy,
    reset_contracts_cache_for_tests,
)
from methods.flow_sentiment import FlowSentimentMethods
from methods.fundamentals import FundamentalsMethods
from methods._news_catalysts.symbol import resolve_symbol_market
from methods._news_catalysts.window import evaluate_catalyst_window
from methods.market_data import MarketDataMethods
from methods.news_catalysts import NewsCatalystMethods


WORKSPACE_CONTRACTS_ROOT = Path(__file__).resolve().parents[2] / "contracts"


@pytest.fixture(autouse=True)
def reset_contract_caches() -> Iterator[None]:
    reset_contracts_cache_for_tests()
    yield
    reset_contracts_cache_for_tests()


def test_market_data_policy_loads_shared_contract_artifact() -> None:
    policy = load_market_data_policy()

    assert policy["searchProviderOrder"]["US"] == ["yfinance"]
    assert policy["searchProviderOrder"]["HK"] == ["yfinance"]
    assert policy["searchProviderOrder"]["COMMODITY"] == ["tushare", "akshare"]
    assert policy["priceProviderOrder"]["A"] == ["tushare", "akshare"]
    assert policy["priceProviderOrder"]["HK"] == ["akshare", "yfinance"]
    assert policy["priceProviderOrder"]["COMMODITY"] == ["tushare", "akshare"]
    assert policy["fxProviderOrder"] == ["akshare", "yfinance", "frankfurter"]


def test_news_catalyst_policy_loads_shared_contract_artifact() -> None:
    policy = load_news_catalyst_policy()

    assert policy["schemaVersion"] == 1
    assert policy["announcementProviderOrder"]["A"] == ["cninfo", "eastmoney_notice"]
    assert policy["announcementProviderOrder"]["HK"] == [
        "hkexnews",
        "hsi_index_notices",
    ]
    assert policy["providerStatus"]["sse_disclosure"] == "planned"
    assert policy["providerStatus"]["sec_efts"] == "planned"
    assert policy["windowDefaults"] == {"lookbackDays": 30, "lookaheadDays": 14}


def test_research_provider_policy_loads_shared_contract_artifact() -> None:
    policy = load_research_provider_policy()

    assert policy["schemaVersion"] == 1
    assert policy["providerStatus"]["akshare"] == "enabled"
    assert policy["fundamentalsProviderOrder"]["A"] == ["tushare", "akshare"]
    assert policy["flowSentimentProviderOrder"]["A"] == ["tushare", "akshare"]
    assert (
        policy["fieldCaveats"]["northboundNetInflow"] == "disclosure_policy_change_2024"
    )


def test_provider_routing_fixture_matches_python_market_data_policy() -> None:
    fixture = load_market_data_fixture("provider-routing.json")
    methods = MarketDataMethods()

    for case in fixture["cases"]:
        enabled_sources = case["enabledSources"]

        if case["kind"] == "search":
            actual = methods._filter_provider_ids(
                methods._search_provider_ids(case["market"]),
                enabled_sources,
            )
        elif case["kind"] == "price":
            actual = methods._filter_provider_ids(
                methods._price_provider_ids(case["symbol"], case["market"]),
                enabled_sources,
            )
        else:
            actual = methods._filter_provider_ids(
                methods._fx_provider_ids(),
                enabled_sources,
            )

        assert actual == case["expectedProviders"], case["name"]


def test_source_priority_fixture_matches_python_market_data_policy() -> None:
    fixture = load_market_data_fixture("provider-priority.json")
    methods = MarketDataMethods()

    for case in fixture["cases"]:
        actual = methods._source_priority(
            case["source"],
            market=case["market"],
            kind=case["kind"],
        )

        assert actual == case["expectedPriority"], case["name"]


def test_news_catalyst_provider_routing_fixture_matches_python_policy() -> None:
    fixture = load_market_data_fixture("news-catalyst-routing.json")
    methods = NewsCatalystMethods()

    for case in fixture["cases"]:
        actual = methods._filter_provider_ids(
            methods._provider_ids(case["market"]),
            case["enabledProviders"],
        )

        assert actual == case["expectedProviders"], case["name"]


def test_research_provider_routing_fixture_matches_python_policy() -> None:
    fixture = load_market_data_fixture("research-provider-routing.json")
    fundamentals = FundamentalsMethods()
    flow = FlowSentimentMethods()

    for case in fixture["cases"]:
        method = fundamentals if case["kind"] == "fundamentals" else flow
        policy_key = (
            "fundamentalsProviderOrder"
            if case["kind"] == "fundamentals"
            else "flowSentimentProviderOrder"
        )
        actual = [
            provider_id
            for provider_id in method.policy[policy_key].get(
                case["market"] or "default", []
            )
            if provider_id in case["enabledProviders"]
            and method.policy["providerStatus"].get(provider_id) == "enabled"
        ]

        assert actual == case["expectedProviders"], case["name"]


def test_news_catalyst_symbol_market_fixture_matches_python_policy() -> None:
    fixture = load_market_data_fixture("news-catalyst-symbol-market.json")

    for case in fixture["cases"]:
        actual = resolve_symbol_market(
            case["symbol"],
            case["market"],
            case["assetMetadata"],
        )

        assert actual["market"] == case["expectedMarket"], case["name"]
        assert actual["reasonCode"] == case["expectedReasonCode"], case["name"]
        assert actual["symbol"] == case["expectedSymbol"], case["name"]


def test_news_catalyst_window_fixture_matches_python_policy() -> None:
    fixture = load_market_data_fixture("news-catalyst-window.json")

    for case in fixture["cases"]:
        actual = evaluate_catalyst_window(
            case["events"],
            lookahead_days=fixture["window"]["lookaheadDays"],
            lookback_days=fixture["window"]["lookbackDays"],
            provider_status=case["providerStatus"],
            reference_date=fixture["referenceDate"],
        )

        assert actual["inCatalystWindow"] == case["expectedInCatalystWindow"], case[
            "name"
        ]


def test_market_data_policy_rejects_invalid_contract_artifact(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    contracts_root = tmp_path / "contracts"
    shutil.copytree(WORKSPACE_CONTRACTS_ROOT, contracts_root)

    policy_path = contracts_root / "market-data-policy.json"
    policy = json.loads(policy_path.read_text(encoding="utf-8"))
    del policy["searchProviderOrder"]["default"]
    policy_path.write_text(f"{json.dumps(policy, indent=2)}\n", encoding="utf-8")

    monkeypatch.setenv("QUANTDESK_CONTRACTS_ROOT", str(contracts_root))
    reset_contracts_cache_for_tests()

    with pytest.raises(RuntimeError) as exc_info:
        load_market_data_policy()

    message = str(exc_info.value)
    assert "searchProviderOrder.default" in message
    assert "required" in message
