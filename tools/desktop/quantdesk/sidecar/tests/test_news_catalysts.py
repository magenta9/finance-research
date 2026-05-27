from __future__ import annotations

import asyncio
from pathlib import Path
import sys
from typing import Any

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import adapters.cninfo_announcements as cninfo_module
import adapters.hsi_index_notices as hsi_module
import methods.news_catalysts as news_module
from adapters.cninfo_announcements import CninfoAnnouncementsAdapter
from adapters.hsi_index_notices import HsiIndexNoticesAdapter
from adapters.sec_edgar import SecEdgarAdapter
from methods.news_catalysts import NewsCatalystMethods


class FakeProvider:
    def __init__(
        self,
        provider_id: str,
        rows: list[dict[str, Any]] | None = None,
        error: Exception | None = None,
    ) -> None:
        self.provider_id = provider_id
        self.rows = rows or []
        self.error = error
        self.calls = 0

    def search_announcements(
        self, symbol: str, query: str, market: str | None = None
    ) -> list[dict[str, Any]]:
        del symbol, query, market
        self.calls += 1
        if self.error is not None:
            raise self.error
        return self.rows


def reference(
    provider_id: str,
    source_id: str,
    title: str,
    *,
    credibility_status: str = "official",
    event_date: str | None = None,
    published_at: str = "2026-05-01T00:00:00.000Z",
    url: str | None = None,
) -> dict[str, Any]:
    return {
        "credibilityStatus": credibility_status,
        "eventDate": event_date,
        "evidenceEligible": False,
        "providerId": provider_id,
        "publishedAt": published_at,
        "snippet": title,
        "sourceId": source_id,
        "title": title,
        "url": url or f"https://example.test/{source_id}",
    }


def test_a_share_uses_cninfo_before_eastmoney_when_primary_has_results() -> None:
    methods = NewsCatalystMethods()
    cninfo = FakeProvider("cninfo", [reference("cninfo", "cninfo:1", "业绩预告")])
    eastmoney = FakeProvider(
        "eastmoney_notice",
        [reference("eastmoney_notice", "eastmoney_notice:1", "回购公告")],
    )
    methods.providers = {"cninfo": cninfo, "eastmoney_notice": eastmoney}

    result = asyncio.run(
        methods.search_news_catalysts(
            query="业绩",
            symbol="000001.SZ",
            enabledProviders=["cninfo", "eastmoney_notice"],
            referenceDate="2026-05-05",
        )
    )

    assert result["qualityStatus"] == "available"
    assert result["attemptedSources"] == ["cninfo"]
    assert result["events"][0]["providerId"] == "cninfo"
    assert result["inCatalystWindow"] is True
    assert cninfo.calls == 1
    assert eastmoney.calls == 0


def test_cninfo_failure_falls_back_to_eastmoney_as_degraded() -> None:
    methods = NewsCatalystMethods()
    methods.providers = {
        "cninfo": FakeProvider("cninfo", error=RuntimeError("cninfo down")),
        "eastmoney_notice": FakeProvider(
            "eastmoney_notice",
            [
                reference(
                    "eastmoney_notice",
                    "eastmoney_notice:1",
                    "回购公告",
                    credibility_status="aggregator",
                )
            ],
        ),
    }

    result = asyncio.run(
        methods.search_news_catalysts(
            query="回购",
            symbol="000001.SZ",
            enabledProviders=["cninfo", "eastmoney_notice", "sse_disclosure"],
            referenceDate="2026-05-05",
        )
    )

    assert result["qualityStatus"] == "degraded"
    assert result["attemptedSources"] == ["cninfo", "eastmoney_notice"]
    assert result["providerErrors"] == [
        {"providerId": "cninfo", "message": "cninfo down"}
    ]
    assert result["events"][0]["credibilityStatus"] == "aggregator"


def test_successful_empty_provider_returns_available_false_window() -> None:
    methods = NewsCatalystMethods()
    methods.providers = {"sec_edgar": FakeProvider("sec_edgar", [])}

    result = asyncio.run(
        methods.search_news_catalysts(
            query="AAPL",
            symbol="AAPL",
            enabledProviders=["sec_edgar", "sec_efts"],
            referenceDate="2026-05-05",
        )
    )

    assert result["qualityStatus"] == "available"
    assert result["events"] == []
    assert result["inCatalystWindow"] is False
    assert result["attemptedSources"] == ["sec_edgar"]


def test_unresolved_market_returns_unknown_without_blind_search() -> None:
    methods = NewsCatalystMethods()

    result = asyncio.run(
        methods.search_news_catalysts(
            query="000001",
            symbol="000001",
            referenceDate="2026-05-05",
        )
    )

    assert result["qualityStatus"] == "unavailable"
    assert result["inCatalystWindow"] == "unknown"
    assert result["attemptedSources"] == []
    assert "unresolved" in result["coverageNotes"][0]


def test_hk_index_symbol_returns_unavailable_source_not_covered() -> None:
    methods = NewsCatalystMethods()
    hkexnews = FakeProvider(
        "hkexnews",
        [reference("hkexnews", "hkexnews:1", "Unexpected HKEX row")],
    )
    methods.providers = {"hkexnews": hkexnews}

    result = asyncio.run(
        methods.search_news_catalysts(
            query="HSTECH",
            symbol="HSTECH",
            market="HK",
            enabledProviders=["hkexnews"],
            referenceDate="2026-05-05",
        )
    )

    assert result["qualityStatus"] == "unavailable"
    assert result["inCatalystWindow"] == "unknown"
    assert result["attemptedSources"] == []
    assert result["events"] == []
    assert "not a numeric HK issuer code" in result["warnings"][0]
    assert hkexnews.calls == 0


def test_hk_index_symbol_uses_hsi_provider_after_hkex_filter() -> None:
    methods = NewsCatalystMethods()
    hkexnews = FakeProvider(
        "hkexnews",
        [reference("hkexnews", "hkexnews:issuer", "Issuer row should be skipped")],
    )
    hsi = FakeProvider(
        "hsi_index_notices",
        [
            reference(
                "hsi_index_notices",
                "hsi_index_notices:review",
                "Hang Seng Indexes Company Announces Index Review Results",
                url="https://www.hsi.com.hk/static/uploads/contents/en/news/pressRelease/review.pdf",
            )
        ],
    )
    methods.providers = {"hkexnews": hkexnews, "hsi_index_notices": hsi}

    result = asyncio.run(
        methods.search_news_catalysts(
            query="指数调整公告",
            symbol="HSTECH",
            market="HK",
            enabledProviders=["hkexnews", "hsi_index_notices"],
            referenceDate="2026-05-05",
        )
    )

    assert result["qualityStatus"] == "available"
    assert result["attemptedSources"] == ["hsi_index_notices"]
    assert result["events"][0]["providerId"] == "hsi_index_notices"
    assert hkexnews.calls == 0
    assert hsi.calls == 1


def test_hk_chinese_hstech_symbol_uses_hsi_provider_after_hkex_filter() -> None:
    methods = NewsCatalystMethods()
    hkexnews = FakeProvider(
        "hkexnews",
        [reference("hkexnews", "hkexnews:issuer", "Issuer row should be skipped")],
    )
    hsi = FakeProvider(
        "hsi_index_notices",
        [
            reference(
                "hsi_index_notices",
                "hsi_index_notices:hstech",
                "HSTECH Weekly Update",
                url="https://www.hsi.com.hk/static/uploads/contents/en/dl_centre/hstech/update.pdf",
            )
        ],
    )
    methods.providers = {"hkexnews": hkexnews, "hsi_index_notices": hsi}

    result = asyncio.run(
        methods.search_news_catalysts(
            query="恒生科技指数 科技股 互联网",
            symbol="恒生科技指数",
            market="HK",
            enabledProviders=["hkexnews", "hsi_index_notices"],
            referenceDate="2026-05-05",
        )
    )

    assert result["qualityStatus"] == "available"
    assert result["attemptedSources"] == ["hsi_index_notices"]
    assert result["events"][0]["providerId"] == "hsi_index_notices"
    assert hkexnews.calls == 0
    assert hsi.calls == 1


def test_hsi_index_notices_filters_official_hstech_items(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_download_items(download_name: str) -> list[dict[str, Any]]:
        if download_name == "press-releases":
            return [
                {
                    "title": "Hang Seng Indexes Company Announces Index Review Results",
                    "url": "/static/uploads/contents/en/news/pressRelease/20260213T174500.pdf",
                    "lastUpdate": "2026-02-13 17:45:00",
                }
            ]
        return [
            {
                "title": "Methodology Change in the Hang Seng High Dividend 30 Index",
                "url": "/static/uploads/contents/en/news/indexChgNotice/high-dividend.pdf",
                "lastUpdate": "2026-04-30 16:45:16",
            },
            {
                "title": "HSTECH Weekly Update",
                "url": "/static/uploads/contents/en/dl_centre/hstech/update.pdf",
                "lastUpdate": "2026-04-25 00:00:00",
            },
        ]

    monkeypatch.setattr(hsi_module, "_load_download_items", fake_download_items)
    adapter = HsiIndexNoticesAdapter()

    rows = adapter.search_announcements("^HSTECH.HK", "指数调整公告", "HK")

    assert [row["title"] for row in rows] == [
        "Hang Seng Indexes Company Announces Index Review Results",
    ]
    assert rows[0]["publishedAt"] == "2026-02-13T17:45:00.000Z"
    assert rows[0]["url"].startswith("https://www.hsi.com.hk/")


def test_cninfo_resolves_fund_stock_token_and_filters_rows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_stock_list(dataset_name: str) -> list[dict[str, Any]]:
        if dataset_name == "fund_stock.json":
            return [{"code": "159740", "orgId": "jjjl0000039"}]
        return []

    post_payloads: list[dict[str, str]] = []

    def fake_post_json(url: str, data: dict[str, str]) -> dict[str, Any]:
        del url
        post_payloads.append(data)
        return {
            "announcements": [
                {
                    "announcementId": "right",
                    "announcementTime": 1776787200000,
                    "announcementTitle": "大成<em>恒生科技</em>ETF季度报告",
                    "secCode": "159740",
                },
                {
                    "announcementId": "wrong",
                    "announcementTime": 1776787200000,
                    "announcementTitle": "其他证券公告",
                    "secCode": "159741",
                },
            ]
        }

    monkeypatch.setattr(cninfo_module, "_load_stock_list", fake_stock_list)
    adapter = CninfoAnnouncementsAdapter()
    monkeypatch.setattr(adapter, "_post_json", fake_post_json)

    rows = adapter.search_announcements("159740", "恒生科技")

    assert post_payloads[0]["column"] == "fund"
    assert post_payloads[0]["stock"] == "159740,jjjl0000039"
    assert len(rows) == 1
    assert rows[0]["sourceId"] == "cninfo:right"
    assert rows[0]["title"] == "大成恒生科技ETF季度报告"


def test_cninfo_zero_record_null_announcements_returns_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        cninfo_module,
        "_load_stock_list",
        lambda dataset_name: (
            [{"code": "159740", "orgId": "jjjl0000039"}]
            if dataset_name == "fund_stock.json"
            else []
        ),
    )
    adapter = CninfoAnnouncementsAdapter()
    monkeypatch.setattr(
        adapter,
        "_post_json",
        lambda url, data: {"announcements": None, "totalRecordNum": 0},
    )

    assert adapter.search_announcements("159740", "指数调整公告") == []


def test_cninfo_unresolved_symbol_does_not_search_all_market(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(cninfo_module, "_load_stock_list", lambda dataset_name: [])
    adapter = CninfoAnnouncementsAdapter()

    def fail_post_json(url: str, data: dict[str, str]) -> dict[str, Any]:
        raise AssertionError("CNINFO should not perform an all-market query")

    monkeypatch.setattr(adapter, "_post_json", fail_post_json)

    assert adapter.search_announcements("159740", "恒生科技") == []


def test_all_provider_failures_raise_rpc_level_error() -> None:
    methods = NewsCatalystMethods()
    methods.providers = {
        "sec_edgar": FakeProvider("sec_edgar", error=RuntimeError("sec down"))
    }

    with pytest.raises(RuntimeError, match="All news catalyst providers failed"):
        asyncio.run(
            methods.search_news_catalysts(
                query="AAPL",
                symbol="AAPL",
                enabledProviders=["sec_edgar"],
                referenceDate="2026-05-05",
            )
        )


def test_dedupes_same_provider_url_before_event_projection() -> None:
    methods = NewsCatalystMethods()
    methods.providers = {
        "sec_edgar": FakeProvider(
            "sec_edgar",
            [
                reference(
                    "sec_edgar",
                    "sec_edgar:1",
                    "AAPL 10-Q filing",
                    url="https://example.test/same",
                ),
                reference(
                    "sec_edgar",
                    "sec_edgar:2",
                    "AAPL 10-Q filing",
                    url="https://example.test/same",
                ),
            ],
        )
    }

    result = asyncio.run(
        methods.search_news_catalysts(
            query="AAPL",
            symbol="AAPL",
            enabledProviders=["sec_edgar"],
            referenceDate="2026-05-05",
        )
    )

    assert len(result["events"]) == 1


def test_lookahead_requires_published_future_event_date() -> None:
    methods = NewsCatalystMethods()
    methods.providers = {
        "sec_edgar": FakeProvider(
            "sec_edgar",
            [
                reference(
                    "sec_edgar",
                    "sec_edgar:event",
                    "AAPL shareholder meeting",
                    event_date="2026-05-15",
                    published_at="2026-05-01T00:00:00.000Z",
                )
            ],
        )
    }

    result = asyncio.run(
        methods.search_news_catalysts(
            query="AAPL",
            symbol="AAPL",
            enabledProviders=["sec_edgar"],
            referenceDate="2026-05-05",
        )
    )

    assert result["inCatalystWindow"] is True


def test_fetch_market_source_creates_evidence_provenance(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(news_module, "_reject_private_host", lambda host: None)
    monkeypatch.setattr(
        news_module,
        "_fetch_url_bytes",
        lambda url: (
            b"<html><title>Notice</title><body>Fetched announcement body.</body></html>"
        ),
    )
    methods = NewsCatalystMethods()
    methods.providers = {
        "cninfo": FakeProvider(
            "cninfo",
            [
                reference(
                    "cninfo",
                    "cninfo:announcement-1",
                    "Repurchase announcement",
                    url="https://static.cninfo.com.cn/source.html",
                )
            ],
        )
    }

    asyncio.run(
        methods.search_news_catalysts(
            query="回购",
            symbol="000001.SZ",
            enabledProviders=["cninfo"],
            referenceDate="2026-05-05",
        )
    )

    result = asyncio.run(methods.fetch_market_source(sourceId="cninfo:announcement-1"))

    assert result["evidenceEligible"] is True
    assert result["contentHash"].startswith("sha256:")
    assert result["provenance"][0]["providerIds"] == ["cninfo"]
    assert result["provenance"][0]["qualityStatus"] == "pass"

    def test_fetch_market_source_parses_pdf_body(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(news_module, "_reject_private_host", lambda host: None)
        monkeypatch.setattr(news_module, "_fetch_url_bytes", lambda url: b"%PDF fake")
        monkeypatch.setattr(
            news_module,
            "_extract_pdf_text",
            lambda body: (
                "暂停申购、赎回业务期间，本基金二级市场交易正常进行。恢复申购、赎回业务的时间将另行公告。"
            ),
        )
        methods = NewsCatalystMethods()
        methods.providers = {
            "cninfo": FakeProvider(
                "cninfo",
                [
                    reference(
                        "cninfo",
                        "cninfo:announcement-1",
                        "暂停申购赎回公告",
                        url="https://static.cninfo.com.cn/source.pdf",
                    )
                ],
            )
        }

        asyncio.run(
            methods.search_announcements(
                query="暂停申购赎回",
                symbol="159740",
                enabledProviders=["cninfo"],
            )
        )

        result = asyncio.run(
            methods.fetch_market_source(sourceId="cninfo:announcement-1")
        )

        assert result["provenance"][0]["qualityStatus"] == "pass"
        assert result["provenance"][0]["warnings"] == []
        assert "恢复申购、赎回业务" in result["summary"]
        assert "二级市场交易正常" in result["textPreview"]


def test_fetch_market_source_rejects_uncached_source_id() -> None:
    methods = NewsCatalystMethods()

    with pytest.raises(RuntimeError, match="Unknown sourceId"):
        asyncio.run(
            methods.fetch_market_source(
                sourceId="cninfo:announcement-1",
                url="https://static.cninfo.com.cn/source.html",
            )
        )


def test_fetch_market_source_rejects_non_https_url() -> None:
    methods = NewsCatalystMethods()

    with pytest.raises(RuntimeError, match="only supports https"):
        asyncio.run(methods.fetch_market_source(url="http://127.0.0.1/source.html"))


def test_fetch_market_source_rejects_unallowed_host_before_dns(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []

    def reject_private_host(host: str) -> None:
        calls.append(host)
        raise AssertionError("DNS validation should not run for non-allowlisted host")

    monkeypatch.setattr(news_module, "_reject_private_host", reject_private_host)
    methods = NewsCatalystMethods()

    with pytest.raises(RuntimeError, match="not an allowed disclosure host"):
        asyncio.run(methods.fetch_market_source(url="https://example.test/source.html"))

    assert calls == []


def test_sec_edgar_uses_cached_ticker_map() -> None:
    adapter = SecEdgarAdapter(user_agent="QuantDesk test")
    calls: list[str] = []

    def fake_get_json(url: str) -> dict[str, Any]:
        calls.append(url)
        if url.endswith("company_tickers.json"):
            return {"0": {"cik_str": 320193, "ticker": "AAPL", "title": "Apple Inc."}}
        return {
            "filings": {
                "recent": {
                    "accessionNumber": ["0000320193-26-000001"],
                    "filingDate": ["2026-05-01"],
                    "form": ["10-Q"],
                    "primaryDocument": ["aapl-20260501.htm"],
                }
            }
        }

    adapter._get_json = fake_get_json  # type: ignore[method-assign]

    first = adapter.search_announcements("AAPL", "10-Q")
    second = adapter.search_announcements("AAPL", "10-Q")

    assert first[0]["sourceId"] == "sec_edgar:0000320193-26-000001"
    assert second[0]["sourceId"] == "sec_edgar:0000320193-26-000001"
    assert calls.count("https://www.sec.gov/files/company_tickers.json") == 1
