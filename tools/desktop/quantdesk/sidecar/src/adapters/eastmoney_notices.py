from __future__ import annotations

import json
from typing import Any
from urllib import parse, request


class EastmoneyNoticesAdapter:
    provider_id = "eastmoney_notice"
    credibility_status = "aggregator"
    structure_version = "eastmoney-security-ann-v1"

    def _get_json(self, url: str) -> dict[str, Any]:
        req = request.Request(
            url,
            headers={"User-Agent": "QuantDesk/0.1 disclosure-fetch"},
        )

        with request.urlopen(req, timeout=12) as response:
            return json.loads(response.read().decode("utf-8", errors="replace"))

    def search_announcements(
        self,
        symbol: str,
        query: str,
        market: str | None = None,
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        del market
        params = parse.urlencode(
            {
                "sr": "-1",
                "page_size": str(limit),
                "page_index": "1",
                "ann_type": "A",
                "client_source": "web",
                "stock_list": symbol,
                "f_node": "0",
                "s_node": "0",
            }
        )
        data = self._get_json(
            f"https://np-anotice-stock.eastmoney.com/api/security/ann?{params}"
        )
        records = (
            data.get("data", {}).get("list")
            if isinstance(data.get("data"), dict)
            else None
        )

        if not isinstance(records, list):
            raise RuntimeError(
                "Eastmoney notice response structure mismatch: data.list missing."
            )

        normalized_query = query.strip().lower()
        results: list[dict[str, Any]] = []
        for item in records:
            if not isinstance(item, dict):
                continue

            title = str(item.get("title") or item.get("notice_title") or "")
            if normalized_query and normalized_query not in title.lower():
                continue

            art_code = str(item.get("art_code") or item.get("notice_id") or "")
            published_at = _eastmoney_date_to_iso(
                str(item.get("notice_date") or item.get("display_time") or "")
            )
            url = (
                f"https://data.eastmoney.com/notices/detail/{symbol}/{art_code}.html"
                if art_code
                else "https://data.eastmoney.com/notices/"
            )

            results.append(
                {
                    "credibilityStatus": self.credibility_status,
                    "evidenceEligible": False,
                    "providerId": self.provider_id,
                    "publishedAt": published_at,
                    "snippet": title,
                    "sourceId": f"eastmoney_notice:{art_code or parse.quote(url, safe='')}",
                    "structureVersion": self.structure_version,
                    "title": title or "Eastmoney notice",
                    "url": url,
                }
            )

        return results[:limit]


def _eastmoney_date_to_iso(value: str) -> str | None:
    if not value:
        return None
    return value if "T" in value else f"{value[:10]}T00:00:00.000Z"
