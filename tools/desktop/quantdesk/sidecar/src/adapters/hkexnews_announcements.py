from __future__ import annotations

import re
from datetime import date, timedelta
from html import unescape
from typing import Any
from urllib import parse, request


class HkexnewsAnnouncementsAdapter:
    provider_id = "hkexnews"
    credibility_status = "official"
    structure_version = "hkexnews-title-search-html-v1"

    def _get_text(self, url: str) -> str:
        req = request.Request(
            url,
            headers={"User-Agent": "QuantDesk/0.1 disclosure-fetch"},
        )

        with request.urlopen(req, timeout=12) as response:
            return response.read().decode("utf-8", errors="replace")

    def search_announcements(
        self,
        symbol: str,
        query: str,
        market: str | None = None,
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        del market
        today = date.today()
        params = parse.urlencode(
            {
                "lang": "EN",
                "market": "SEHK",
                "stockId": symbol.lstrip("0") or symbol,
                "category": "0",
                "from": (today - timedelta(days=90)).strftime("%Y/%m/%d"),
                "to": today.strftime("%Y/%m/%d"),
                "title": query,
            }
        )
        html = self._get_text(
            f"https://www1.hkexnews.hk/search/titlesearch.xhtml?{params}"
        )
        rows = re.findall(r"<tr[^>]*>(.*?)</tr>", html, flags=re.IGNORECASE | re.DOTALL)

        if not rows:
            raise RuntimeError(
                "HKEXnews response structure mismatch: result rows missing."
            )

        results: list[dict[str, Any]] = []
        for row in rows:
            text = _clean_html(row)
            href_match = re.search(
                r"href=[\"'](?P<href>[^\"']+)[\"']", row, flags=re.IGNORECASE
            )
            date_match = re.search(r"(20\d{2}[-/]\d{1,2}[-/]\d{1,2})", text)
            if href_match is None or date_match is None:
                continue

            href = href_match.group("href")
            url = parse.urljoin("https://www1.hkexnews.hk", href)
            published_at = date_match.group(1).replace("/", "-")
            title = (
                text.replace(date_match.group(1), "").strip() or "HKEXnews announcement"
            )
            source_id = f"hkexnews:{parse.quote(url, safe='')}"
            results.append(
                {
                    "credibilityStatus": self.credibility_status,
                    "evidenceEligible": False,
                    "providerId": self.provider_id,
                    "publishedAt": f"{published_at}T00:00:00.000Z",
                    "snippet": title,
                    "sourceId": source_id,
                    "structureVersion": self.structure_version,
                    "title": title,
                    "url": url,
                }
            )

        return results[:limit]


def _clean_html(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", unescape(value))).strip()
