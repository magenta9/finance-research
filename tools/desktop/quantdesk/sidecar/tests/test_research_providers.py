from __future__ import annotations

import asyncio
from pathlib import Path
import sys
from typing import Any

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from adapters import research_providers
from adapters.research_providers import AKShareResearchProvider, TuShareResearchProvider
from adapters.research_providers import _latest_tushare_fina_indicator_row
from methods.flow_sentiment import FlowSentimentMethods
from methods.fundamentals import FundamentalsMethods


class FakeFundamentalsProvider:
    def __init__(
        self, result: dict[str, Any] | None = None, error: Exception | None = None
    ) -> None:
        self.calls = 0
        self.error = error
        self.result = result or {
            "asOf": "2026-05-05",
            "dataAgeDays": 35,
            "market": "A",
            "metrics": {
                "period": {"fiscalPeriod": "2025Q4", "reportDate": "2026-03-31"},
                "profitability": {"roe": 0.18},
            },
            "qualityStatus": "available",
            "rowsUsed": 1,
            "symbol": "600519",
            "warnings": [],
        }

    def fetch_fundamentals(
        self, symbol: str, market: str, asset_metadata: dict[str, object] | None = None
    ) -> dict[str, Any]:
        del symbol, market, asset_metadata
        self.calls += 1
        if self.error is not None:
            raise self.error
        return self.result


class FakeValuationProvider:
    def __init__(self, result: dict[str, Any]) -> None:
        self.calls = 0
        self.result = result

    def fetch_underlying_index_valuation(
        self, symbol: str, market: str, asset_metadata: dict[str, object] | None = None
    ) -> dict[str, Any]:
        del symbol, market, asset_metadata
        self.calls += 1
        return self.result


class FakeFlowProvider:
    def __init__(
        self, result: dict[str, Any] | None = None, error: Exception | None = None
    ) -> None:
        self.calls = 0
        self.error = error
        self.result = result or {
            "asOf": "2026-05-05",
            "market": "A",
            "qualityStatus": "available",
            "rowsUsed": 1,
            "signals": {"flow": {"mainNetInflow": 1200000}},
            "symbol": "600519",
            "warnings": [],
        }

    def fetch_flow_sentiment(
        self,
        symbol: str | None,
        market: str,
        asset_metadata: dict[str, object] | None = None,
    ) -> dict[str, Any]:
        del symbol, market, asset_metadata
        self.calls += 1
        if self.error is not None:
            raise self.error
        return self.result


def test_fundamentals_requires_resolved_market() -> None:
    methods = FundamentalsMethods()
    methods.providers = {"akshare": FakeFundamentalsProvider()}

    result = asyncio.run(
        methods.fetch_fundamentals(
            symbol="600519", market=None, enabledProviders=["akshare"]
        )
    )

    assert result["qualityStatus"] == "unavailable"
    assert result["attemptedSources"] == []
    assert "resolved market" in result["warnings"][0]
    assert methods.providers["akshare"].calls == 0


def test_server_registers_research_provider_rpc_methods() -> None:
    from server import METHODS

    assert callable(METHODS["fetch_fundamentals"])
    assert callable(METHODS["fetch_flow_sentiment"])


def test_fundamentals_falls_back_after_unavailable_provider() -> None:
    methods = FundamentalsMethods()
    methods.providers = {
        "tushare": FakeFundamentalsProvider(
            {
                "asOf": None,
                "dataAgeDays": None,
                "market": "A",
                "metrics": {"period": {"fiscalPeriod": None, "reportDate": None}},
                "qualityStatus": "unavailable",
                "rowsUsed": 0,
                "symbol": "600519",
                "warnings": ["not covered"],
            }
        ),
        "akshare": FakeFundamentalsProvider(),
    }

    result = asyncio.run(
        methods.fetch_fundamentals(
            symbol="600519", market="A", enabledProviders=["tushare", "akshare"]
        )
    )

    assert result["qualityStatus"] == "available"
    assert result["attemptedSources"] == ["tushare", "akshare"]
    assert result["dataProvenance"][0]["sourceId"] == "fundamentals:akshare:600519"


def test_fundamentals_returns_a_market_etf_facts_before_provider_order() -> None:
    methods = FundamentalsMethods()
    methods.providers = {"tushare": FakeFundamentalsProvider()}

    result = asyncio.run(
        methods.fetch_fundamentals(
            symbol="159740",
            market="A",
            enabledProviders=["tushare"],
            assetMetadata={
                "assetClass": "equity",
                "name": "恒生科技ETF",
                "underlyingMarket": "HK",
            },
        )
    )

    assert result["qualityStatus"] == "degraded"
    assert result["attemptedSources"] == []
    assert (
        result["dataProvenance"][0]["sourceId"] == "fundamentals:asset_metadata:159740"
    )
    assert (
        result["metrics"]["fundFacts"]["issuerStyleFundamentals"] == "asset_not_covered"
    )
    assert result["metrics"]["fundFacts"]["assetName"] == "恒生科技ETF"
    assert methods.providers["tushare"].calls == 0


def test_a_market_etf_fundamentals_can_include_akshare_csindex_valuation() -> None:
    methods = FundamentalsMethods()
    methods.providers = {
        "akshare": FakeValuationProvider(
            {
                "providerAttempted": True,
                "rowsUsed": 1,
                "underlyingValuation": {
                    "asOf": "2026-05-06",
                    "dividendYield": 0.021,
                    "indexCode": "000300",
                    "indexName": "沪深300",
                    "peTtm": 12.3,
                    "providerId": "akshare",
                    "sourceId": "index_valuation:akshare:csindex:000300",
                    "status": "available",
                },
                "warnings": [],
            }
        ),
    }

    result = asyncio.run(
        methods.fetch_fundamentals(
            symbol="510300",
            market="A",
            enabledProviders=["akshare"],
            assetMetadata={
                "assetClass": "equity",
                "csindexCode": "000300",
                "name": "沪深300ETF",
            },
        )
    )

    valuation = result["metrics"]["fundFacts"]["underlyingValuation"]
    assert result["qualityStatus"] == "degraded"
    assert result["attemptedSources"] == ["akshare"]
    assert result["dataProvenance"][1]["providerIds"] == ["akshare"]
    assert valuation["status"] == "available"
    assert valuation["peTtm"] == 12.3
    assert valuation["dividendYield"] == 0.021


def test_permission_error_is_structured_and_temporarily_disables_provider() -> None:
    methods = FundamentalsMethods()
    methods.providers = {
        "tushare": FakeFundamentalsProvider(
            error=RuntimeError("TuShare token 积分不足")
        )
    }

    first = asyncio.run(
        methods.fetch_fundamentals(
            symbol="600519", market="A", enabledProviders=["tushare"]
        )
    )
    second = asyncio.run(
        methods.fetch_fundamentals(
            symbol="600519", market="A", enabledProviders=["tushare"]
        )
    )

    assert first["qualityStatus"] == "unavailable"
    assert first["providerErrors"][0]["errorType"] == "permission"
    assert first["providerErrors"][0]["disabledUntil"]
    assert methods.providers["tushare"].calls == 1
    assert second["attemptedSources"] == []
    assert "temporarily disabled" in second["warnings"][0]


def test_flow_applies_northbound_caveat_without_requiring_northbound_data() -> None:
    methods = FlowSentimentMethods()
    methods.providers = {"akshare": FakeFlowProvider()}

    result = asyncio.run(
        methods.fetch_flow_sentiment(
            symbol="600519", market="A", enabledProviders=["akshare"]
        )
    )

    assert result["qualityStatus"] == "available"
    assert result["signals"]["flow"]["northboundNetInflow"] is None
    assert (
        result["signals"]["flow"]["northboundAvailabilityCaveat"]
        == "disclosure_policy_change_2024"
    )


def test_tushare_fina_indicator_dedupes_update_flag() -> None:
    frame = pd.DataFrame(
        [
            {
                "ts_code": "600519.SH",
                "end_date": "20251231",
                "roe": 10,
                "update_flag": "0",
            },
            {
                "ts_code": "600519.SH",
                "end_date": "20251231",
                "roe": 18,
                "update_flag": "1",
            },
            {
                "ts_code": "600519.SH",
                "end_date": "20241231",
                "roe": 12,
                "update_flag": "1",
            },
        ]
    )

    row = _latest_tushare_fina_indicator_row(frame)

    assert row is not None
    assert row["end_date"] == "20251231"
    assert row["roe"] == 18
    assert row["update_flag"] == "1"


def test_a_market_etf_fundamentals_return_fund_facts_without_stock_endpoint(
    monkeypatch,
) -> None:
    class FakeAkshare:
        calls = 0

        def stock_financial_analysis_indicator_em(
            self, **kwargs: object
        ) -> pd.DataFrame:
            del kwargs
            self.calls += 1
            raise AssertionError(
                "stock fundamentals endpoint should not be called for ETF assets"
            )

    fake_akshare = FakeAkshare()
    monkeypatch.setattr(research_providers, "ak", fake_akshare)

    result = AKShareResearchProvider().fetch_fundamentals(
        "159740",
        "A",
        {"assetClass": "equity", "name": "恒生科技ETF", "underlyingMarket": "HK"},
    )

    assert fake_akshare.calls == 0
    assert result["qualityStatus"] == "degraded"
    assert result["metrics"]["fundFacts"]["assetName"] == "恒生科技ETF"
    assert result["metrics"]["fundFacts"]["underlyingMarket"] == "HK"
    assert "issuer-style fundamentals" in result["warnings"][0]


def test_tushare_fundamentals_skips_a_market_etf_without_client() -> None:
    result = TuShareResearchProvider().fetch_fundamentals(
        "159740",
        "A",
        {"assetClass": "equity", "name": "恒生科技ETF"},
    )

    assert result["qualityStatus"] == "unavailable"
    assert "Fund/ETF fundamentals" in result["warnings"][0]
