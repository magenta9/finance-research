from __future__ import annotations

import asyncio
from pathlib import Path
import sys
from unittest.mock import patch

import pandas as pd


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from adapters.akshare import AKShareAdapter
from adapters.tushare_adapter import TuShareAdapter
from adapters.yfinance_adapter import YFinanceAdapter
from methods.market_data import MarketDataMethods


def test_fetch_prices_returns_empty_result_with_warnings_when_all_providers_fail() -> (
    None
):
    methods = MarketDataMethods()

    async def run() -> dict[str, object]:
        with patch.object(
            methods.yfinance,
            "fetch_prices",
            return_value={"symbol": "SPY", "prices": [], "warnings": ["yf failed"]},
        ):
            return await methods.fetch_prices(
                "SPY", "2026-01-01", "2026-01-10", market="US"
            )

    result = asyncio.run(run())

    assert result["prices"] == []
    assert result["attemptedSources"] == ["yfinance"]
    assert "No real price data available for SPY." in result["warnings"]


def test_fetch_prices_stops_after_akshare_hk_index_fallback() -> None:
    methods = MarketDataMethods()
    akshare_response = {
        "symbol": "^HSTECH",
        "prices": [
            {
                "adjusted_close": 5102.79,
                "close": 5102.79,
                "date": "2026-05-08",
                "high": 5122.91,
                "low": 5047.17,
                "open": 5079.77,
                "source": "akshare-hk-index-em",
                "volume": None,
            }
        ],
        "warnings": ["AKShare used Eastmoney HK index history for ^HSTECH."],
    }

    async def run() -> dict[str, object]:
        with (
            patch.object(methods.tushare, "fetch_prices") as tushare_fetch,
            patch.object(
                methods.akshare, "fetch_prices", return_value=akshare_response
            ),
            patch.object(methods.yfinance, "fetch_prices") as yfinance_fetch,
        ):
            result = await methods.fetch_prices(
                "^HSTECH",
                "2026-05-01",
                "2026-05-08",
                market="HK",
                assetMetadata={"instrumentType": "index"},
            )
            tushare_fetch.assert_not_called()
            yfinance_fetch.assert_not_called()
            return result

    result = asyncio.run(run())

    assert result["attemptedSources"] == ["akshare"]
    assert [row["source"] for row in result["prices"]] == ["akshare-hk-index-em"]


def test_akshare_fetch_prices_uses_nav_fallback_when_etf_history_fails() -> None:
    adapter = AKShareAdapter()

    nav_frame = pd.DataFrame(
        {
            "净值日期": ["2026-01-02", "2026-01-03"],
            "单位净值": [1.234, 1.25],
        }
    )

    with patch("adapters.akshare.prices.ak") as mock_ak:
        mock_ak.fund_etf_hist_em.side_effect = RuntimeError("eastmoney reset")
        mock_ak.fund_open_fund_info_em.return_value = nav_frame

        result = adapter.fetch_prices("513100", "2026-01-01", "2026-01-10")

    assert [row["date"] for row in result["prices"]] == ["2026-01-02", "2026-01-03"]
    assert result["prices"][0]["close"] == 1.234
    assert result["prices"][0]["adjusted_close"] == 1.234
    assert result["prices"][0]["open"] is None
    assert result["prices"][0]["source"] == "akshare-nav"
    assert any(
        "AKShare ETF history request failed for 513100" in warning
        for warning in result["warnings"]
    )
    assert any(
        "AKShare used NAV fallback for 513100" in warning
        for warning in result["warnings"]
    )


def test_akshare_fetch_prices_uses_hk_index_history_for_hstech() -> None:
    adapter = AKShareAdapter()

    history_frame = pd.DataFrame(
        {
            "date": ["2026-05-06", "2026-05-07", "2026-05-08"],
            "open": [4971.69, 5089.11, 5079.77],
            "high": [5026.76, 5137.85, 5122.91],
            "low": [4924.43, 5070.30, 5047.17],
            "latest": [4969.20, 5121.10, 5102.79],
        }
    )

    with patch("adapters.akshare.prices.ak") as mock_ak:
        mock_ak.stock_hk_index_daily_em.return_value = history_frame
        result = adapter.fetch_prices(
            "^HSTECH",
            "2026-05-07",
            "2026-05-08",
            market="HK",
            asset_metadata={"instrumentType": "index"},
        )

    assert mock_ak.stock_hk_index_daily_em.call_args.kwargs == {"symbol": "HSTECH"}
    assert [row["date"] for row in result["prices"]] == ["2026-05-07", "2026-05-08"]
    assert result["prices"][0]["close"] == 5121.10
    assert result["prices"][0]["adjusted_close"] == 5121.10
    assert result["prices"][0]["source"] == "akshare-hk-index-em"
    assert any(
        "AKShare used Eastmoney HK index history for ^HSTECH" in warning
        for warning in result["warnings"]
    )


def test_akshare_nav_fallback_returns_recent_prior_nav_when_window_is_empty() -> None:
    adapter = AKShareAdapter()

    nav_frame = pd.DataFrame(
        {
            "净值日期": ["2026-04-28", "2026-04-29"],
            "单位净值": [2.301, 2.317],
        }
    )

    with patch("adapters.akshare.prices.ak") as mock_ak:
        mock_ak.fund_etf_hist_em.return_value = pd.DataFrame()
        mock_ak.fund_open_fund_info_em.return_value = nav_frame

        result = adapter.fetch_prices("000369", "2026-04-30", "2026-05-04")

    assert [row["date"] for row in result["prices"]] == ["2026-04-29"]
    assert result["prices"][0]["close"] == 2.317
    assert result["prices"][0]["source"] == "akshare-nav"
    assert any(
        "AKShare used NAV fallback for 000369" in warning
        for warning in result["warnings"]
    )


def test_fetch_prices_uses_tushare_for_a_market_without_akshare_fallback() -> None:
    methods = MarketDataMethods()
    tushare_rows = [
        {
            "date": date,
            "open": None,
            "high": None,
            "low": None,
            "close": 1.23,
            "volume": None,
            "adjusted_close": 1.23,
            "source": "tushare-qfq",
        }
        for date in [
            "2026-01-01",
            "2026-01-02",
            "2026-01-05",
            "2026-01-06",
            "2026-01-07",
            "2026-01-08",
            "2026-01-09",
        ]
    ]

    async def run() -> dict[str, object]:
        with (
            patch.object(
                methods.tushare,
                "fetch_prices",
                return_value={
                    "symbol": "159919",
                    "prices": tushare_rows,
                    "warnings": [],
                },
            ),
            patch.object(
                methods.akshare,
                "fetch_prices",
                side_effect=AssertionError("akshare should not be called"),
            ),
        ):
            return await methods.fetch_prices(
                "159919", "2026-01-01", "2026-01-10", market="A"
            )

    result = asyncio.run(run())

    assert result["attemptedSources"] == ["tushare"]
    assert result["prices"] == tushare_rows
    assert result["warnings"] == []


def test_fetch_prices_does_not_fallback_when_tushare_returns_partial_a_market_rows() -> (
    None
):
    methods = MarketDataMethods()

    async def run() -> dict[str, object]:
        with (
            patch.object(
                methods.tushare,
                "fetch_prices",
                return_value={
                    "symbol": "159919",
                    "prices": [
                        {
                            "date": "2026-01-02",
                            "open": None,
                            "high": None,
                            "low": None,
                            "close": 1.23,
                            "volume": None,
                            "adjusted_close": 1.23,
                            "source": "tushare-qfq",
                        }
                    ],
                    "warnings": ["TuShare returned partial history for 159919."],
                },
            ),
            patch.object(
                methods.akshare,
                "fetch_prices",
                side_effect=AssertionError("akshare should not be called"),
            ),
        ):
            return await methods.fetch_prices(
                "159919", "2026-01-01", "2026-01-10", market="A"
            )

    result = asyncio.run(run())

    assert result["attemptedSources"] == ["tushare"]
    assert [row["date"] for row in result["prices"]] == ["2026-01-02"]


def test_fetch_prices_falls_back_to_akshare_nav_for_open_fund() -> None:
    methods = MarketDataMethods()
    akshare_rows = [
        {
            "date": "2026-04-30",
            "open": None,
            "high": None,
            "low": None,
            "close": 1.234,
            "volume": None,
            "adjusted_close": 1.234,
            "source": "akshare-nav",
        }
    ]

    async def run() -> dict[str, object]:
        with (
            patch.object(
                methods.tushare,
                "fetch_prices",
                return_value={
                    "symbol": "000369",
                    "prices": [],
                    "warnings": [
                        "TuShare could not resolve canonical tsCode for 000369; run asset lookup or metadata backfill first."
                    ],
                },
            ),
            patch.object(
                methods.akshare,
                "fetch_prices",
                return_value={
                    "symbol": "000369",
                    "prices": akshare_rows,
                    "warnings": [
                        "AKShare used NAV fallback for 000369; OHLC and volume are unavailable."
                    ],
                },
            ),
        ):
            return await methods.fetch_prices(
                "000369", "2026-04-30", "2026-05-04", market="A"
            )

    result = asyncio.run(run())

    assert result["attemptedSources"] == ["tushare", "akshare"]
    assert result["prices"] == akshare_rows
    assert (
        "AKShare used NAV fallback for 000369; OHLC and volume are unavailable."
        in result["warnings"]
    )


def test_search_assets_falls_back_to_akshare_for_open_fund_code() -> None:
    methods = MarketDataMethods()
    akshare_rows = [
        {
            "assetClass": "equity",
            "currency": "CNY",
            "market": "A",
            "metadata": {
                "issueDate": "2013-12-10",
                "issueDateSource": "akshare-fund-name",
                "underlyingMarket": "US",
            },
            "name": "广发全球医疗保健指数人民币(QDII)A",
            "source": "akshare",
            "symbol": "000369",
        }
    ]

    async def run() -> list[dict[str, object]]:
        with (
            patch.object(methods.tushare, "search_assets", return_value=[]),
            patch.object(methods.akshare, "search_assets", return_value=akshare_rows),
        ):
            return await methods.search_assets("000369", market="A")

    results = asyncio.run(run())

    assert results == akshare_rows


def test_tushare_search_assets_normalizes_a_and_hk_symbols() -> None:
    adapter = TuShareAdapter(token="token")

    class FakeClient:
        def stock_basic(self, **_kwargs: object) -> pd.DataFrame:
            return pd.DataFrame(
                [
                    {"ts_code": "000001.SZ", "name": "平安银行"},
                ]
            )

        def fund_basic(self, **_kwargs: object) -> pd.DataFrame:
            return pd.DataFrame(
                [
                    {"ts_code": "159919.SZ", "name": "沪深300ETF"},
                ]
            )

        def index_basic(self, **_kwargs: object) -> pd.DataFrame:
            return pd.DataFrame(
                [
                    {"ts_code": "000300.SH", "name": "沪深300"},
                ]
            )

        def hk_basic(self, **_kwargs: object) -> pd.DataFrame:
            return pd.DataFrame(
                [
                    {"ts_code": "00700.HK", "name": "腾讯控股"},
                ]
            )

    with patch.object(adapter, "_get_client", return_value=FakeClient()):
        a_results = adapter.search_assets("沪深300ETF", "A")
        hk_results = adapter.search_assets("腾讯", "HK")

    assert a_results[0] == {
        "assetClass": "equity",
        "currency": "CNY",
        "exchange": "SZSE",
        "market": "A",
        "metadata": {"exchange": "SZSE", "tsCode": "159919.SZ", "tsCodeAsset": "FD"},
        "name": "沪深300ETF",
        "source": "tushare",
        "symbol": "159919",
    }
    assert hk_results[0]["symbol"] == "00700.HK"
    assert hk_results[0]["currency"] == "HKD"


def test_tushare_search_assets_prefers_index_before_etf_products() -> None:
    adapter = TuShareAdapter(token="token")

    class FakeClient:
        def stock_basic(self, **_kwargs: object) -> pd.DataFrame:
            return pd.DataFrame([])

        def fund_basic(self, **_kwargs: object) -> pd.DataFrame:
            return pd.DataFrame(
                [
                    {"ts_code": "159919.SZ", "name": "沪深300ETF"},
                ]
            )

        def index_basic(self, **_kwargs: object) -> pd.DataFrame:
            return pd.DataFrame(
                [
                    {"ts_code": "000300.SH", "name": "沪深300"},
                ]
            )

    with patch.object(adapter, "_get_client", return_value=FakeClient()):
        results = adapter.search_assets("沪深300", "A")

    assert [result["symbol"] for result in results[:2]] == ["000300", "159919"]
    assert [result["metadata"]["tsCodeAsset"] for result in results[:2]] == ["I", "FD"]


def test_tushare_search_assets_resolves_canonical_index_codes() -> None:
    adapter = TuShareAdapter(token="token")

    class FakeClient:
        def stock_basic(self, **_kwargs: object) -> pd.DataFrame:
            return pd.DataFrame([])

        def fund_basic(self, **_kwargs: object) -> pd.DataFrame:
            return pd.DataFrame([])

        def index_basic(self, **_kwargs: object) -> pd.DataFrame:
            return pd.DataFrame(
                [
                    {"ts_code": "000300.SH", "name": "沪深300"},
                ]
            )

    with patch.object(adapter, "_get_client", return_value=FakeClient()):
        results = adapter.search_assets("000300", "A")

    assert results[0]["symbol"] == "000300"
    assert results[0]["metadata"]["tsCode"] == "000300.SH"


def test_tushare_search_assets_resolves_cni_index_codes() -> None:
    adapter = TuShareAdapter(token="token")

    class FakeClient:
        def stock_basic(self, **_kwargs: object) -> pd.DataFrame:
            return pd.DataFrame([])

        def fund_basic(self, **_kwargs: object) -> pd.DataFrame:
            return pd.DataFrame([])

        def index_basic(self, **kwargs: object) -> pd.DataFrame:
            if kwargs.get("market") != "CNI":
                return pd.DataFrame([])
            return pd.DataFrame(
                [
                    {"ts_code": "000369.CNI", "name": "国证红利"},
                ]
            )

    with patch.object(adapter, "_get_client", return_value=FakeClient()):
        results = adapter.search_assets("000369", "A")

    assert results[0]["symbol"] == "000369"
    assert results[0]["metadata"]["tsCode"] == "000369.CNI"
    assert results[0]["metadata"]["tsCodeAsset"] == "I"


def test_tushare_search_assets_includes_hk_indices_before_etf_products() -> None:
    adapter = TuShareAdapter(token="token")

    class FakeClient:
        def index_basic(self, **kwargs: object) -> pd.DataFrame:
            if kwargs.get("market") != "HK":
                return pd.DataFrame([])
            return pd.DataFrame(
                [
                    {"ts_code": "HSTECH.HK", "name": "恒生科技指数"},
                    {"ts_code": "HSI.HK", "name": "恒生指数"},
                ]
            )

        def hk_basic(self, **_kwargs: object) -> pd.DataFrame:
            return pd.DataFrame(
                [
                    {"ts_code": "03033.HK", "name": "恒生科技ETF", "list_status": "L"},
                ]
            )

    with patch.object(adapter, "_get_client", return_value=FakeClient()):
        results = adapter.search_assets("恒生科技", "HK")

    assert [result["symbol"] for result in results[:2]] == ["HSTECH.HK", "03033.HK"]
    assert results[0]["market"] == "HK"
    assert results[0]["currency"] == "HKD"
    assert results[0]["metadata"]["tsCodeAsset"] == "I"


def test_yfinance_search_assets_includes_hang_seng_indices() -> None:
    adapter = YFinanceAdapter()

    tech_results = adapter.search_assets("恒生科技", "HK")
    hsi_results = adapter.search_assets("恒生指数", "HK")

    assert tech_results[0]["symbol"] == "^HSTECH"
    assert tech_results[0]["name"] == "Hang Seng TECH Index"
    assert hsi_results[0]["symbol"] == "^HSI"
    assert hsi_results[0]["name"] == "Hang Seng Index"


def test_market_search_ranks_hk_index_seed_before_domestic_etfs() -> None:
    methods = MarketDataMethods()
    akshare_rows = [
        {
            "assetClass": "equity",
            "currency": "CNY",
            "market": "A",
            "metadata": {"underlyingMarket": "HK"},
            "name": "恒生科技ETF大成",
            "source": "akshare",
            "symbol": "159740",
        }
    ]

    async def run() -> list[dict[str, object]]:
        with (
            patch.object(
                methods.tushare, "search_assets", side_effect=RuntimeError("no token")
            ),
            patch.object(methods.akshare, "search_assets", return_value=akshare_rows),
        ):
            return await methods.search_assets("恒生科技")

    results = asyncio.run(run())

    assert [result["symbol"] for result in results[:2]] == ["^HSTECH", "159740"]
    assert results[0]["market"] == "HK"


def test_tushare_search_assets_includes_commodity_futures_main_contracts() -> None:
    adapter = TuShareAdapter(token="token")

    class FakeClient:
        def fut_basic(self, **kwargs: object) -> pd.DataFrame:
            if kwargs.get("exchange") != "SHFE":
                return pd.DataFrame([])
            return pd.DataFrame(
                [
                    {
                        "ts_code": "RB2605.SHF",
                        "symbol": "RB2605",
                        "fut_code": "RB",
                        "name": "螺纹钢",
                        "exchange": "SHFE",
                    }
                ]
            )

    with patch.object(adapter, "_get_client", return_value=FakeClient()):
        results = adapter.search_assets("RB", "COMMODITY")

    assert results[0] == {
        "assetClass": "commodity",
        "currency": "CNY",
        "exchange": "SHFE",
        "market": "COMMODITY",
        "metadata": {
            "contractType": "dominant_continuous",
            "exchange": "SHFE",
            "instrumentType": "futures",
            "priceSeriesSource": "tushare-futures",
            "seriesAdjustment": "raw_main_continuous",
            "sourceSymbol": "RB.SHF",
            "tsCode": "RB.SHF",
            "tsCodeAsset": "FT",
            "underlyingSymbol": "RB",
        },
        "name": "螺纹钢主连",
        "source": "tushare",
        "symbol": "RB9999",
    }


def test_tushare_search_assets_keeps_index_candidates_when_fund_catalog_fails() -> None:
    adapter = TuShareAdapter(token="token")

    class FakeClient:
        def stock_basic(self, **_kwargs: object) -> pd.DataFrame:
            return pd.DataFrame([])

        def fund_basic(self, **_kwargs: object) -> pd.DataFrame:
            raise RuntimeError("fund catalog unavailable")

        def index_basic(self, **kwargs: object) -> pd.DataFrame:
            if kwargs.get("market") != "CNI":
                return pd.DataFrame([])
            return pd.DataFrame(
                [
                    {"ts_code": "000369.CNI", "name": "国证红利"},
                ]
            )

    with patch.object(adapter, "_get_client", return_value=FakeClient()):
        results = adapter.search_assets("000369", "A")

    assert results[0]["metadata"]["tsCode"] == "000369.CNI"


def test_tushare_search_assets_returns_more_than_twelve_results() -> None:
    adapter = TuShareAdapter(token="token")

    class FakeClient:
        def stock_basic(self, **_kwargs: object) -> pd.DataFrame:
            return pd.DataFrame([])

        def fund_basic(self, **_kwargs: object) -> pd.DataFrame:
            return pd.DataFrame(
                [
                    {"ts_code": f"159{index:03d}.SZ", "name": f"沪深300ETF{index}"}
                    for index in range(20)
                ]
            )

        def index_basic(self, **_kwargs: object) -> pd.DataFrame:
            return pd.DataFrame([])

    with patch.object(adapter, "_get_client", return_value=FakeClient()):
        results = adapter.search_assets("沪深300", "A")

    assert len(results) == 20


def test_market_data_search_caps_results_at_fifty() -> None:
    methods = MarketDataMethods()
    provider_rows = [
        {
            "assetClass": "equity",
            "currency": "CNY",
            "exchange": "SZSE",
            "market": "A",
            "metadata": {"tsCode": f"159{index:03d}.SZ"},
            "name": f"沪深300ETF{index}",
            "source": "tushare",
            "symbol": f"159{index:03d}",
        }
        for index in range(60)
    ]

    async def run() -> list[dict[str, object]]:
        with patch.object(methods.tushare, "search_assets", return_value=provider_rows):
            return await methods.search_assets(
                "沪深300", market="A", enabledSources=["tushare"]
            )

    results = asyncio.run(run())

    assert len(results) == 50


def test_tushare_fetch_prices_uses_pro_bar_and_normalizes_rows() -> None:
    adapter = TuShareAdapter(token="token")
    client = object()

    class FakeTs:
        def pro_bar(
            self,
            ts_code: str,
            start_date: str,
            end_date: str,
            asset: str,
            adj: str,
            api: object,
        ) -> pd.DataFrame:
            assert ts_code == "159919.SZ"
            assert start_date == "20260101"
            assert end_date == "20260110"
            assert asset == "FD"
            assert adj == "qfq"
            assert api is client
            return pd.DataFrame(
                [
                    {
                        "trade_date": "20260102",
                        "open": 1.1,
                        "high": 1.2,
                        "low": 1.0,
                        "close": 1.15,
                        "vol": 1000,
                    }
                ]
            )

    with (
        patch.object(adapter, "_get_client", return_value=client),
        patch("adapters.tushare.runtime.ts", FakeTs()),
    ):
        result = adapter.fetch_prices("159919", "2026-01-01", "2026-01-10")

    assert result["prices"] == [
        {
            "adjusted_close": 1.15,
            "close": 1.15,
            "date": "2026-01-02",
            "high": 1.2,
            "low": 1.0,
            "open": 1.1,
            "source": "tushare-qfq",
            "volume": 1000.0,
        }
    ]


def test_tushare_fetch_prices_keeps_unknown_market_sz_stock_on_equity_channel() -> None:
    adapter = TuShareAdapter(token="token")
    client = object()

    class FakeTs:
        def pro_bar(
            self,
            ts_code: str,
            start_date: str,
            end_date: str,
            asset: str,
            adj: str,
            api: object,
        ) -> pd.DataFrame:
            assert ts_code == "000001.SZ"
            assert asset == "E"
            return pd.DataFrame(
                [
                    {
                        "trade_date": "20260102",
                        "open": 10,
                        "high": 11,
                        "low": 9,
                        "close": 10.5,
                        "vol": 1000,
                    }
                ]
            )

    with (
        patch.object(adapter, "_get_client", return_value=client),
        patch("adapters.tushare.runtime.ts", FakeTs()),
    ):
        result = adapter.fetch_prices("000001", "2026-01-01", "2026-01-10")

    assert len(result["prices"]) == 1


def test_tushare_fetch_prices_resolves_cni_index_from_catalog() -> None:
    adapter = TuShareAdapter(token="token")

    class FakeClient:
        def stock_basic(self, **_kwargs: object) -> pd.DataFrame:
            return pd.DataFrame([])

        def fund_basic(self, **_kwargs: object) -> pd.DataFrame:
            return pd.DataFrame([])

        def index_basic(self, **kwargs: object) -> pd.DataFrame:
            if kwargs.get("market") != "CNI":
                return pd.DataFrame([])
            return pd.DataFrame(
                [
                    {"ts_code": "000369.CNI", "name": "国证红利"},
                ]
            )

    client = FakeClient()

    class FakeTs:
        def pro_bar(
            self,
            ts_code: str,
            start_date: str,
            end_date: str,
            asset: str,
            adj: str,
            api: object,
        ) -> pd.DataFrame:
            assert ts_code == "000369.CNI"
            assert start_date == "20260430"
            assert end_date == "20260504"
            assert asset == "I"
            assert adj == "qfq"
            assert api is client
            return pd.DataFrame(
                [
                    {
                        "trade_date": "20260430",
                        "open": 1000,
                        "high": 1010,
                        "low": 990,
                        "close": 1005,
                        "vol": 100,
                    }
                ]
            )

    with (
        patch.object(adapter, "_get_client", return_value=client),
        patch("adapters.tushare.runtime.ts", FakeTs()),
    ):
        result = adapter.fetch_prices("000369", "2026-04-30", "2026-05-04", "A")

    assert result["warnings"] == []
    assert result["prices"][0]["source"] == "tushare-qfq"
    assert result["prices"][0]["date"] == "2026-04-30"


def test_tushare_fetch_prices_synthesizes_raw_futures_main_series() -> None:
    adapter = TuShareAdapter(token="token")

    class FakeClient:
        def fut_mapping(self, **kwargs: object) -> pd.DataFrame:
            assert kwargs == {
                "end_date": "20260105",
                "start_date": "20260101",
                "ts_code": "RB.SHF",
            }
            return pd.DataFrame(
                [
                    {"trade_date": "20260102", "mapping_ts_code": "RB2601.SHF"},
                    {"trade_date": "20260105", "mapping_ts_code": "RB2605.SHF"},
                ]
            )

        def fut_daily(self, **kwargs: object) -> pd.DataFrame:
            if kwargs["ts_code"] == "RB2601.SHF":
                return pd.DataFrame(
                    [
                        {
                            "trade_date": "20260102",
                            "open": 3200,
                            "high": 3230,
                            "low": 3190,
                            "close": 3210,
                            "vol": 100,
                        },
                        {
                            "trade_date": "20260105",
                            "open": 9900,
                            "high": 9900,
                            "low": 9900,
                            "close": 9900,
                            "vol": 1,
                        },
                    ]
                )
            if kwargs["ts_code"] == "RB2605.SHF":
                return pd.DataFrame(
                    [
                        {
                            "trade_date": "20260102",
                            "open": 8800,
                            "high": 8800,
                            "low": 8800,
                            "close": 8800,
                            "vol": 1,
                        },
                        {
                            "trade_date": "20260105",
                            "open": 3300,
                            "high": 3330,
                            "low": 3290,
                            "close": 3310,
                            "vol": 120,
                        },
                    ]
                )
            raise AssertionError(f"unexpected ts_code {kwargs['ts_code']}")

    with patch.object(adapter, "_get_client", return_value=FakeClient()):
        result = adapter.fetch_prices(
            "RB9999",
            "2026-01-01",
            "2026-01-05",
            "COMMODITY",
            {
                "contractType": "dominant_continuous",
                "instrumentType": "futures",
                "tsCode": "RB.SHF",
                "tsCodeAsset": "FT",
            },
        )

    assert [row["date"] for row in result["prices"]] == ["2026-01-02", "2026-01-05"]
    assert [row["close"] for row in result["prices"]] == [3210.0, 3310.0]
    assert result["prices"][0] == {
        "adjusted_close": None,
        "close": 3210.0,
        "date": "2026-01-02",
        "high": 3230.0,
        "low": 3190.0,
        "open": 3200.0,
        "source": "tushare-futures-main",
        "volume": 100.0,
    }
    assert result["prices"][1]["source"] == "tushare-futures-main"
    assert any("not back-adjusted" in warning for warning in result["warnings"])


def test_akshare_futures_fallback_resolves_9999_main_symbol() -> None:
    adapter = AKShareAdapter()

    assert adapter._is_futures_request("RB9999", "COMMODITY", None)
    assert adapter._resolve_akshare_futures_symbol("RB9999", None) == "RB0"
    assert (
        adapter._resolve_akshare_futures_symbol(
            "RB9999",
            {"sourceSymbol": "RB.SHF"},
        )
        == "RB0"
    )


def test_fetch_prices_falls_back_to_akshare_for_commodity_futures() -> None:
    methods = MarketDataMethods()
    akshare_rows = [
        {
            "date": "2026-01-02",
            "open": 3200,
            "high": 3230,
            "low": 3190,
            "close": 3210,
            "volume": 100,
            "adjusted_close": None,
            "source": "akshare-futures-main-sina",
        }
    ]

    async def run() -> dict[str, object]:
        with (
            patch.object(
                methods.tushare,
                "fetch_prices",
                return_value={
                    "symbol": "RB9999",
                    "prices": [],
                    "warnings": [
                        "TuShare futures dominant request failed for RB9999: token denied"
                    ],
                },
            ),
            patch.object(
                methods.akshare,
                "fetch_prices",
                return_value={
                    "symbol": "RB9999",
                    "prices": akshare_rows,
                    "warnings": [
                        "AKShare used Sina futures main-contract fallback for RB9999"
                    ],
                },
            ),
        ):
            return await methods.fetch_prices(
                "RB9999",
                "2026-01-01",
                "2026-01-05",
                market="COMMODITY",
                assetMetadata={
                    "contractType": "dominant_continuous",
                    "instrumentType": "futures",
                    "tsCode": "RB.SHF",
                    "tsCodeAsset": "FT",
                },
                enabledSources=["tushare", "akshare"],
            )

    result = asyncio.run(run())

    assert result["attemptedSources"] == ["tushare", "akshare"]
    assert result["prices"] == akshare_rows


def test_tushare_search_surfaces_catalog_failures_without_caching() -> None:
    adapter = TuShareAdapter(token="token")

    class FailingClient:
        attempts = 0

        def stock_basic(self, **_kwargs: object) -> pd.DataFrame:
            self.attempts += 1
            raise RuntimeError("token invalid")

        def fund_basic(self, **_kwargs: object) -> pd.DataFrame:
            raise RuntimeError("token invalid")

        def hk_basic(self, **_kwargs: object) -> pd.DataFrame:
            raise RuntimeError("token invalid")

    client = FailingClient()

    with patch.object(adapter, "_get_client", return_value=client):
        for _ in range(2):
            try:
                adapter.search_assets("沪深300", "A")
            except RuntimeError as error:
                assert "catalog requests failed" in str(error)
            else:
                raise AssertionError("Expected catalog failure to surface")

    assert client.attempts == 2


def test_tushare_forces_official_https_api_url() -> None:
    adapter = TuShareAdapter(token="token")

    class FakeDataApi:
        pass

    with patch("adapters.tushare.runtime.DataApi", FakeDataApi):
        adapter._configure_https_transport()

    assert (
        getattr(FakeDataApi, "_DataApi__http_url") == "https://api.waditu.com/dataapi"
    )


def test_fetch_fx_rates_normalizes_boc_reference_rates() -> None:
    adapter = AKShareAdapter()
    frame = pd.DataFrame(
        {
            "日期": ["2026-01-02"],
            "美元": [700.0],
            "港币": [90.0],
        }
    )

    with patch("adapters.akshare.fx.ak") as mock_ak:
        mock_ak.currency_boc_safe.return_value = frame

        usd_cny = adapter.fetch_fx_rates("USD/CNY", "2026-01-01", "2026-01-10")
        cny_usd = adapter.fetch_fx_rates("CNY/USD", "2026-01-01", "2026-01-10")

    assert usd_cny["rates"] == [
        {"date": "2026-01-02", "rate": 7.0, "source": "akshare"}
    ]
    assert cny_usd["rates"] == [
        {"date": "2026-01-02", "rate": 0.14285714, "source": "akshare-derived"}
    ]


def test_fetch_fx_rates_prefers_direct_provider_rows_and_marks_inverse_derivation() -> (
    None
):
    methods = MarketDataMethods()

    async def run() -> dict[str, object]:
        with (
            patch.object(
                methods.akshare,
                "fetch_fx_rates",
                return_value={
                    "pair": "CNY/USD",
                    "rates": [
                        {
                            "date": "2026-01-02",
                            "rate": 0.139,
                            "source": "akshare-derived",
                        }
                    ],
                    "warnings": ["derived from direct quote"],
                },
            ),
            patch.object(
                methods.yfinance,
                "fetch_fx_rates",
                return_value={
                    "pair": "CNY/USD",
                    "rates": [
                        {
                            "date": "2026-01-02",
                            "rate": 0.1389,
                            "source": "yfinance-derived",
                        }
                    ],
                    "warnings": [],
                },
            ),
            patch.object(
                methods.frankfurter,
                "fetch_fx_rates",
                return_value={
                    "pair": "CNY/USD",
                    "rates": [],
                    "warnings": ["frankfurter unavailable"],
                },
            ),
        ):
            return await methods.fetch_fx_rates("CNY/USD", "2026-01-01", "2026-01-10")

    result = asyncio.run(run())

    assert result["attemptedSources"] == ["akshare", "yfinance", "frankfurter"]
    assert result["rates"] == [
        {"date": "2026-01-02", "rate": 0.139, "source": "akshare-derived"}
    ]
    assert "derived from direct quote" in result["warnings"]
