from __future__ import annotations

import json
import threading
import time
from datetime import datetime, timezone
from typing import Any
from urllib import request

SEC_FORMS = {"8-K", "10-Q", "10-K", "6-K", "20-F", "DEF 14A"}


class HostRateLimiter:
    def __init__(self, min_interval_seconds: float = 0.11) -> None:
        self.min_interval_seconds = min_interval_seconds
        self._lock = threading.Lock()
        self._last_request = 0.0

    def wait(self) -> None:
        with self._lock:
            now = time.monotonic()
            delay = self.min_interval_seconds - (now - self._last_request)
            if delay > 0:
                time.sleep(delay)
            self._last_request = time.monotonic()


class SecEdgarAdapter:
    provider_id = "sec_edgar"
    credibility_status = "official"
    structure_version = "sec-submissions-json-v1"

    def __init__(
        self, user_agent: str = "QuantDesk/0.1 contact@example.invalid"
    ) -> None:
        self.user_agent = user_agent
        self.rate_limiter = HostRateLimiter()
        self._ticker_cache: dict[str, Any] | None = None
        self._ticker_cache_loaded_at = 0.0

    def _get_json(self, url: str) -> dict[str, Any]:
        self.rate_limiter.wait()
        req = request.Request(
            url,
            headers={
                "Accept": "application/json",
                "User-Agent": self.user_agent,
            },
        )

        with request.urlopen(req, timeout=12) as response:
            return json.loads(response.read().decode("utf-8", errors="replace"))

    def _ticker_map(self) -> dict[str, Any]:
        if (
            self._ticker_cache is not None
            and time.time() - self._ticker_cache_loaded_at < 24 * 60 * 60
        ):
            return self._ticker_cache

        data = self._get_json("https://www.sec.gov/files/company_tickers.json")
        self._ticker_cache = data
        self._ticker_cache_loaded_at = time.time()
        return data

    def _resolve_cik(self, symbol: str) -> str | None:
        normalized_symbol = symbol.strip().upper()
        for entry in self._ticker_map().values():
            if not isinstance(entry, dict):
                continue
            if str(entry.get("ticker") or "").upper() == normalized_symbol:
                return str(entry.get("cik_str") or "").zfill(10)
        return None

    def search_announcements(
        self,
        symbol: str,
        query: str,
        market: str | None = None,
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        del market
        cik = self._resolve_cik(symbol)
        if cik is None:
            return []

        submissions = self._get_json(f"https://data.sec.gov/submissions/CIK{cik}.json")
        recent = (
            submissions.get("filings", {}).get("recent")
            if isinstance(submissions.get("filings"), dict)
            else None
        )
        if not isinstance(recent, dict):
            raise RuntimeError(
                "SEC submissions response structure mismatch: filings.recent missing."
            )

        forms = recent.get("form") or []
        accession_numbers = recent.get("accessionNumber") or []
        filing_dates = recent.get("filingDate") or []
        primary_documents = recent.get("primaryDocument") or []
        normalized_query = query.strip().lower()
        results: list[dict[str, Any]] = []

        for index, form in enumerate(forms):
            form_value = str(form or "")
            accession = str(_safe_list_get(accession_numbers, index) or "")
            filing_date = str(_safe_list_get(filing_dates, index) or "")
            primary_document = str(_safe_list_get(primary_documents, index) or "")
            title = f"{symbol.upper()} {form_value} filing"

            if form_value not in SEC_FORMS:
                continue
            if (
                normalized_query
                and normalized_query not in title.lower()
                and normalized_query not in form_value.lower()
            ):
                continue

            accession_path = accession.replace("-", "")
            cik_path = str(int(cik))
            if primary_document:
                url = f"https://www.sec.gov/Archives/edgar/data/{cik_path}/{accession_path}/{primary_document}"
            else:
                url = f"https://www.sec.gov/Archives/edgar/data/{cik_path}/{accession_path}/{accession}-index.html"
            results.append(
                {
                    "credibilityStatus": self.credibility_status,
                    "evidenceEligible": False,
                    "filingType": form_value,
                    "providerId": self.provider_id,
                    "publishedAt": _sec_date_to_iso(filing_date),
                    "snippet": title,
                    "sourceId": f"sec_edgar:{accession}",
                    "structureVersion": self.structure_version,
                    "title": title,
                    "url": url,
                }
            )

            if len(results) >= limit:
                break

        return results


def _safe_list_get(values: Any, index: int) -> Any:
    return values[index] if isinstance(values, list) and index < len(values) else None


def _sec_date_to_iso(value: str) -> str | None:
    if not value:
        return None
    try:
        datetime.fromisoformat(value[:10])
    except ValueError:
        return None
    return f"{value[:10]}T00:00:00.000Z"
