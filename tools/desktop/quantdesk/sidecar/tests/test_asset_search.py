from __future__ import annotations

import asyncio
import os
from pathlib import Path
import sys
from unittest.mock import Mock, patch

import pandas as pd


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from adapters.akshare import AKShareAdapter
from adapters.akshare.proxy import _bypass_proxy_for_domestic
from adapters.akshare.utils import (
    _classify_etf,
    _classify_fund,
    _infer_underlying_market,
)
from adapters.yfinance_adapter import YFinanceAdapter
from methods.market_data import MarketDataMethods


def test_classify_etf_equity() -> None:
    assert _classify_etf("沪深300ETF") == ("A", "equity")
    assert _classify_etf("红利ETF") == ("A", "equity")
    assert _classify_etf("纳指ETF") == ("A", "equity")


def test_classify_etf_fixed_income() -> None:
    assert _classify_etf("国债ETF") == ("BOND", "fixed_income")
    assert _classify_etf("信用债ETF") == ("BOND", "fixed_income")
    assert _classify_etf("城投债ETF") == ("BOND", "fixed_income")
    assert _classify_etf("中债1-3年政金债ETF") == ("BOND", "fixed_income")


def test_classify_etf_commodity() -> None:
    assert _classify_etf("黄金ETF") == ("COMMODITY", "commodity")
    assert _classify_etf("豆粕ETF") == ("COMMODITY", "commodity")
    assert _classify_etf("有色金属ETF") == ("COMMODITY", "commodity")


def test_classify_etf_alternative() -> None:
    assert _classify_etf("保障房REITs") == ("A", "alternative")
    assert _classify_etf("不动产信托ETF") == ("A", "alternative")


def test_classify_etf_cash() -> None:
    assert _classify_etf("银华日利ETF") == ("A", "cash")


def test_classify_fund_open_ended_types() -> None:
    assert _classify_fund("工银前沿医疗股票A", "股票型") == ("A", "equity")
    assert _classify_fund("中欧中短债债券A", "债券型") == ("BOND", "fixed_income")
    assert _classify_fund("华夏现金增利货币A", "货币型") == ("A", "cash")
    assert _classify_fund("华宝油气", "商品型") == ("COMMODITY", "commodity")
    assert _classify_fund("华夏REITs精选", "混合型") == ("A", "alternative")


def test_infer_underlying_market() -> None:
    assert _infer_underlying_market("纳指ETF") == {"underlyingMarket": "US"}
    assert _infer_underlying_market("标普500ETF") == {"underlyingMarket": "US"}
    assert _infer_underlying_market("恒生ETF") == {"underlyingMarket": "HK"}
    assert _infer_underlying_market("沪深300ETF") == {}


def _make_em_daily_catalog_df() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "基金代码": [
                "512070",
                "510300",
                "510500",
                "159941",
                "511260",
                "159985",
                "513500",
                "513180",
                "513970",
                "513060",
                "513330",
                "511990",
            ],
            "基金简称": [
                "沪深300非银ETF",
                "沪深300ETF华泰",
                "中证500ETF南方",
                "纳斯达克100ETF",
                "十年国开债ETF",
                "豆粕期货ETF",
                "标普500ETF",
                "恒生科技ETF",
                "恒生消费ETF",
                "恒生医疗ETF",
                "恒生互联网ETF",
                "华宝现金添益ETF",
            ],
            "类型": [
                "指数型-股票",
                "指数型-股票",
                "指数型-股票",
                "指数型-海外股票",
                "指数型-固收",
                "商品（不含QDII）",
                "指数型-海外股票",
                "指数型-海外股票",
                "指数型-海外股票",
                "指数型-海外股票",
                "指数型-海外股票",
                "货币型",
            ],
        }
    )


def _make_ths_catalog_df() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "基金代码": ["510300", "510500", "159513", "511260"],
            "基金名称": [
                "华泰柏瑞沪深300ETF",
                "南方中证500ETF",
                "大成纳斯达克100ETF(QDII)",
                "上证10年期国债ETF",
            ],
            "基金类型": ["股票型", "股票型", "股票型", "债券型"],
        }
    )


def _make_sina_catalog_df() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "代码": ["sh510300", "sh510500", "sz159513"],
            "名称": ["沪深300ETF华泰", "中证500ETF南方", "纳斯达克100ETF大成"],
        }
    )


def _make_fund_name_catalog_df() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "基金代码": ["001717", "010685", "000001"],
            "基金简称": ["工银前沿医疗股票A", "工银前沿医疗股票C", "华夏成长混合A"],
            "类型": ["股票型", "股票型", "混合型"],
            "拼音": ["gongyianyan yiliao", "gongyianyan yiliao", "huaxiamei"],
            "成立日期": ["2014-01-01", "2014-01-01", "2001-12-18"],
        }
    )


def _install_remote_catalog_mocks(
    mock_ak,
    *,
    em_daily: pd.DataFrame | None = None,
    ths: pd.DataFrame | None = None,
    sina: pd.DataFrame | None = None,
    fund_name: pd.DataFrame | None = None,
    sse: pd.DataFrame | None = None,
    szse: pd.DataFrame | None = None,
) -> None:
    mock_ak.fund_etf_fund_daily_em.return_value = (
        em_daily if em_daily is not None else pd.DataFrame()
    )
    mock_ak.fund_etf_spot_ths.return_value = ths if ths is not None else pd.DataFrame()
    mock_ak.fund_etf_category_sina.return_value = (
        sina if sina is not None else pd.DataFrame()
    )
    mock_ak.fund_name_em.return_value = (
        fund_name if fund_name is not None else pd.DataFrame()
    )
    mock_ak.fund_etf_scale_sse.return_value = sse if sse is not None else pd.DataFrame()
    mock_ak.fund_scale_daily_szse.return_value = (
        szse if szse is not None else pd.DataFrame()
    )
    mock_ak.fund_individual_basic_info_xq.return_value = pd.DataFrame(
        columns=["item", "value"]
    )


def test_search_assets_remote_name_match() -> None:
    adapter = AKShareAdapter()
    with patch("adapters.akshare.catalog.ak") as mock_ak:
        _install_remote_catalog_mocks(mock_ak, em_daily=_make_em_daily_catalog_df())
        results = adapter.search_assets("豆粕期货")

    assert len(results) == 1
    assert results[0]["symbol"] == "159985"
    assert results[0]["assetClass"] == "commodity"
    assert results[0]["market"] == "COMMODITY"


def test_search_assets_remote_code_match() -> None:
    adapter = AKShareAdapter()
    with patch("adapters.akshare.catalog.ak") as mock_ak:
        _install_remote_catalog_mocks(mock_ak, em_daily=_make_em_daily_catalog_df())
        results = adapter.search_assets("159941")

    assert len(results) == 1
    assert results[0]["name"] == "纳斯达克100ETF"


def test_search_assets_cross_border_metadata() -> None:
    adapter = AKShareAdapter()
    with patch("adapters.akshare.catalog.ak") as mock_ak:
        _install_remote_catalog_mocks(mock_ak, em_daily=_make_em_daily_catalog_df())
        results = adapter.search_assets("纳斯达克")

    assert any(item["metadata"] == {"underlyingMarket": "US"} for item in results)


def test_search_assets_resolves_hang_seng_tech_by_chinese_name() -> None:
    adapter = AKShareAdapter()
    with patch("adapters.akshare.catalog.ak") as mock_ak:
        _install_remote_catalog_mocks(mock_ak, em_daily=_make_em_daily_catalog_df())
        results = adapter.search_assets("恒生科技")

    assert results[0]["symbol"] == "513180"
    assert results[0]["market"] == "A"
    assert results[0]["metadata"] == {"underlyingMarket": "HK"}


def test_search_assets_resolves_mainstream_hang_seng_theme_etfs() -> None:
    adapter = AKShareAdapter()
    with patch("adapters.akshare.catalog.ak") as mock_ak:
        _install_remote_catalog_mocks(mock_ak, em_daily=_make_em_daily_catalog_df())

        consumer = adapter.search_assets("恒生消费")
        healthcare = adapter.search_assets("恒生医疗")
        internet = adapter.search_assets("恒生互联网")

    assert consumer[0]["symbol"] == "513970"
    assert healthcare[0]["symbol"] == "513060"
    assert internet[0]["symbol"] == "513330"
    assert all(
        result[0]["market"] == "A" and result[0]["metadata"] == {"underlyingMarket": "HK"}
        for result in (consumer, healthcare, internet)
    )


def test_search_assets_remote_fund_catalog_supports_open_ended_mutual_funds() -> None:
    adapter = AKShareAdapter()

    with patch("adapters.akshare.catalog.ak") as mock_ak:
        _install_remote_catalog_mocks(mock_ak, fund_name=_make_fund_name_catalog_df())
        results = adapter.search_assets("工银前沿医疗")

    assert [item["symbol"] for item in results[:2]] == ["001717", "010685"]
    assert all(item["assetClass"] == "equity" for item in results[:2])


def test_search_assets_includes_issue_date_metadata_from_catalog() -> None:
    adapter = AKShareAdapter()

    with patch("adapters.akshare.catalog.ak") as mock_ak:
        _install_remote_catalog_mocks(mock_ak, fund_name=_make_fund_name_catalog_df())
        results = adapter.search_assets("工银前沿医疗")

    assert results[0]["metadata"]["issueDate"] == "2014-01-01"
    assert results[0]["metadata"]["issueDateSource"] == "akshare-fund-name"


def test_search_assets_enriches_issue_date_metadata_from_single_asset_api() -> None:
    adapter = AKShareAdapter()

    response = Mock()
    response.raise_for_status.return_value = None
    response.json.return_value = {
        "data": {
            "fd_code": "159941",
            "found_date": "2020-01-02",
        }
    }

    with patch("adapters.akshare.catalog.ak") as mock_ak:
        _install_remote_catalog_mocks(mock_ak, em_daily=_make_em_daily_catalog_df())
        with patch("adapters.akshare.catalog.requests.get", return_value=response):
            results = adapter.search_assets("159941")

    assert results[0]["metadata"]["issueDate"] == "2020-01-02"
    assert results[0]["metadata"]["issueDateSource"] == "akshare-xq"


def test_fetch_issue_date_from_detail_ignores_missing_data_payload() -> None:
    adapter = AKShareAdapter()

    response = Mock()
    response.raise_for_status.return_value = None
    response.json.return_value = {
        "result_code": 600001,
        "message": "该基金暂不销售,基金代码：159941",
    }

    with (
        patch("adapters.akshare.catalog.requests.get", return_value=response),
        patch("adapters.akshare.catalog.logger.warning") as mock_warning,
    ):
        result = adapter._fetch_issue_date_from_detail("159941")

    assert result == (None, None)
    mock_warning.assert_not_called()


def test_search_assets_prefers_etf_source_over_open_fund_when_codes_overlap() -> None:
    adapter = AKShareAdapter()

    open_fund = pd.DataFrame(
        {
            "基金代码": ["510300"],
            "基金简称": ["沪深300指数基金A"],
            "类型": ["股票型"],
        }
    )

    with patch("adapters.akshare.catalog.ak") as mock_ak:
        _install_remote_catalog_mocks(
            mock_ak,
            em_daily=_make_em_daily_catalog_df(),
            fund_name=open_fund,
        )
        results = adapter.search_assets("沪深300")

    assert results[0]["symbol"] == "510300"
    assert results[0]["name"].endswith("ETF华泰")


def test_search_assets_cache_hit() -> None:
    adapter = AKShareAdapter()
    with patch("adapters.akshare.catalog.ak") as mock_ak:
        _install_remote_catalog_mocks(
            mock_ak,
            em_daily=_make_em_daily_catalog_df(),
            ths=_make_ths_catalog_df(),
            sina=_make_sina_catalog_df(),
            fund_name=_make_fund_name_catalog_df(),
        )
        adapter.search_assets("豆粕期货")
        adapter.search_assets("工银前沿医疗")

    assert mock_ak.fund_etf_fund_daily_em.call_count == 1
    assert mock_ak.fund_etf_spot_ths.call_count == 1
    assert mock_ak.fund_etf_category_sina.call_count == 1
    assert mock_ak.fund_name_em.call_count == 1


def test_bypass_proxy_for_domestic_keeps_override_until_last_exit() -> None:
    saved_lower = os.environ.get("no_proxy")
    saved_upper = os.environ.get("NO_PROXY")

    try:
        os.environ.pop("no_proxy", None)
        os.environ.pop("NO_PROXY", None)

        first = _bypass_proxy_for_domestic()
        second = _bypass_proxy_for_domestic()

        first.__enter__()
        merged = os.environ["no_proxy"]
        second.__enter__()

        first.__exit__(None, None, None)
        assert os.environ["no_proxy"] == merged
        assert os.environ["NO_PROXY"] == merged

        second.__exit__(None, None, None)
        assert "no_proxy" not in os.environ
        assert "NO_PROXY" not in os.environ
    finally:
        if saved_lower is None:
            os.environ.pop("no_proxy", None)
        else:
            os.environ["no_proxy"] = saved_lower

        if saved_upper is None:
            os.environ.pop("NO_PROXY", None)
        else:
            os.environ["NO_PROXY"] = saved_upper


def test_search_assets_reuses_cached_spot_when_remote_later_breaks() -> None:
    adapter = AKShareAdapter()
    with patch("adapters.akshare.catalog.ak") as mock_ak:
        _install_remote_catalog_mocks(
            mock_ak,
            em_daily=_make_em_daily_catalog_df(),
            fund_name=_make_fund_name_catalog_df(),
        )
        adapter.search_assets("豆粕期货")
        mock_ak.fund_etf_fund_daily_em.side_effect = Exception("network error")
        results = adapter.search_assets("工银前沿医疗")

    assert [item["symbol"] for item in results[:2]] == ["001717", "010685"]
    assert mock_ak.fund_etf_fund_daily_em.call_count == 1


def test_search_assets_falls_back_to_open_fund_catalog_when_etf_source_fails() -> None:
    adapter = AKShareAdapter()

    with patch("adapters.akshare.catalog.ak") as mock_ak:
        mock_ak.fund_etf_fund_daily_em.side_effect = RuntimeError("eastmoney failed")
        _install_remote_catalog_mocks(
            mock_ak,
            ths=_make_ths_catalog_df(),
            sina=_make_sina_catalog_df(),
            fund_name=_make_fund_name_catalog_df(),
        )
        results = adapter.search_assets("工银前沿医疗")

    assert [item["symbol"] for item in results[:2]] == ["001717", "010685"]


def test_search_assets_falls_back_to_etf_catalog_when_fund_source_fails() -> None:
    adapter = AKShareAdapter()

    with patch("adapters.akshare.catalog.ak") as mock_ak:
        mock_ak.fund_name_em.side_effect = RuntimeError("fund catalog failed")
        _install_remote_catalog_mocks(mock_ak, em_daily=_make_em_daily_catalog_df())
        results = adapter.search_assets("沪深300")

    assert results[0]["symbol"] == "510300"


def test_search_assets_special_characters_no_crash() -> None:
    adapter = AKShareAdapter()
    with patch("adapters.akshare.catalog.ak") as mock_ak:
        _install_remote_catalog_mocks(mock_ak, em_daily=_make_em_daily_catalog_df())
        for query in ["(", "(QDII)", "C++", "[test]", "a*b"]:
            results = adapter.search_assets(query)
            assert isinstance(results, list)


def test_search_assets_remote_catalog_supports_core_a_share_queries() -> None:
    adapter = AKShareAdapter()

    with patch("adapters.akshare.catalog.ak") as mock_ak:
        _install_remote_catalog_mocks(mock_ak, em_daily=_make_em_daily_catalog_df())
        hs300 = adapter.search_assets("沪深300")
        csi500 = adapter.search_assets("中证500")

    assert hs300[0]["symbol"] == "510300"
    assert csi500[0]["symbol"] == "510500"


def test_search_assets_falls_back_to_secondary_remote_catalog_when_primary_fails() -> (
    None
):
    adapter = AKShareAdapter()

    with patch("adapters.akshare.catalog.ak") as mock_ak:
        mock_ak.fund_etf_fund_daily_em.side_effect = RuntimeError("eastmoney failed")
        _install_remote_catalog_mocks(
            mock_ak,
            ths=_make_ths_catalog_df(),
            sina=_make_sina_catalog_df(),
        )

        hs300 = adapter.search_assets("沪深300")
        csi500 = adapter.search_assets("中证500")

    assert hs300[0]["symbol"] == "510300"
    assert csi500[0]["symbol"] == "510500"


def test_search_assets_normalizes_sina_exchange_prefixed_codes() -> None:
    adapter = AKShareAdapter()

    with patch("adapters.akshare.catalog.ak") as mock_ak:
        mock_ak.fund_etf_fund_daily_em.side_effect = RuntimeError("eastmoney failed")
        mock_ak.fund_etf_spot_ths.side_effect = RuntimeError("ths failed")
        _install_remote_catalog_mocks(mock_ak, sina=_make_sina_catalog_df())
        results = adapter.search_assets("沪深300")

    assert results[0]["symbol"] == "510300"


def test_yfinance_seed_search_supports_spy_lowercase() -> None:
    adapter = YFinanceAdapter()
    results = adapter.search_assets("spy")
    assert any(item["symbol"] == "SPY" for item in results)


def test_yfinance_seed_search_supports_nasdaq_chinese_keyword() -> None:
    adapter = YFinanceAdapter()
    results = adapter.search_assets("纳斯达克", market="US")
    assert any(item["symbol"] == "QQQ" for item in results)


def test_yfinance_all_market_sentinel_keeps_results() -> None:
    adapter = YFinanceAdapter()
    results = adapter.search_assets("spy", market="ALL")
    assert any(item["symbol"] == "SPY" for item in results)


def test_market_data_methods_all_market_sentinel_keeps_spy() -> None:
    methods = MarketDataMethods()
    with patch.object(methods.akshare, "search_assets", return_value=[]):
        results = asyncio.run(methods.search_assets("spy", market="ALL"))

    assert any(item["symbol"] == "SPY" for item in results)
