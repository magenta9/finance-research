from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import logging
import re
import socket
from datetime import datetime, timezone
from html import unescape
from io import BytesIO
from typing import Any
from urllib import error, parse, request

from pypdf import PdfReader

from adapters.cninfo_announcements import CninfoAnnouncementsAdapter
from adapters.eastmoney_notices import EastmoneyNoticesAdapter
from adapters.hkexnews_announcements import HkexnewsAnnouncementsAdapter
from adapters.hsi_index_notices import HsiIndexNoticesAdapter
from adapters.sec_edgar import SecEdgarAdapter
from contracts import load_news_catalyst_policy

from ._news_catalysts.classify import classify_catalyst
from ._news_catalysts.policy import announcement_provider_ids, filter_provider_ids
from ._news_catalysts.symbol import resolve_symbol_market
from ._news_catalysts.window import evaluate_catalyst_window

logger = logging.getLogger(__name__)

MAX_FETCH_BYTES = 5 * 1024 * 1024

ALLOWED_FETCH_HOSTS: dict[str, tuple[str, ...]] = {
    "cninfo": ("cninfo.com.cn", "static.cninfo.com.cn"),
    "eastmoney_notice": ("eastmoney.com",),
    "hkexnews": ("hkexnews.hk",),
    "hsi_index_notices": ("hsi.com.hk",),
    "sec_edgar": ("sec.gov",),
}


class NewsCatalystMethods:
    def __init__(self) -> None:
        self.policy = load_news_catalyst_policy()
        self.providers = {
            "cninfo": CninfoAnnouncementsAdapter(),
            "eastmoney_notice": EastmoneyNoticesAdapter(),
            "hkexnews": HkexnewsAnnouncementsAdapter(),
            "hsi_index_notices": HsiIndexNoticesAdapter(),
            "sec_edgar": SecEdgarAdapter(),
        }
        self.source_references: dict[str, dict[str, Any]] = {}

    def _provider_ids(self, market: str | None) -> list[str]:
        return announcement_provider_ids(self.policy, market)

    def _filter_provider_ids(
        self, provider_ids: list[str], enabled_providers: list[str]
    ) -> list[str]:
        return filter_provider_ids(provider_ids, enabled_providers)

    async def search_announcements(
        self,
        query: str,
        symbol: str | None = None,
        market: str | None = None,
        enabledProviders: list[str] | None = None,
        assetMetadata: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        resolved = resolve_symbol_market(
            symbol or _first_query_token(query), market, assetMetadata
        )
        if resolved["market"] is None:
            return []

        provider_ids = self._provider_ids(resolved["market"])
        if enabledProviders is not None:
            provider_ids = self._filter_provider_ids(provider_ids, enabledProviders)
        provider_ids = _filter_symbol_supported_providers(
            provider_ids, resolved["market"], resolved["symbol"]
        )
        if not provider_ids:
            return []

        result = await self._search_provider_references(
            provider_ids,
            query=query,
            symbol=resolved["symbol"],
            market=resolved["market"],
        )
        if result["successfulProviderCount"] == 0 and result["providerErrors"]:
            raise RuntimeError(
                "All news catalyst providers failed: "
                + "; ".join(
                    f"{error['providerId']}: {error['message']}"
                    for error in result["providerErrors"]
                )
            )

        return result["references"]

    async def search_news_catalysts(
        self,
        query: str,
        symbol: str | None = None,
        market: str | None = None,
        enabledProviders: list[str] | None = None,
        lookbackDays: int | None = None,
        lookaheadDays: int | None = None,
        referenceDate: str | None = None,
        assetMetadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        resolved = resolve_symbol_market(
            symbol or _first_query_token(query), market, assetMetadata
        )
        lookback_days = int(
            lookbackDays or self.policy["windowDefaults"]["lookbackDays"]
        )
        lookahead_days = int(
            lookaheadDays or self.policy["windowDefaults"]["lookaheadDays"]
        )
        warnings = list(resolved["warnings"])

        if resolved["market"] is None:
            window = evaluate_catalyst_window(
                [],
                lookahead_days=lookahead_days,
                lookback_days=lookback_days,
                provider_status="unavailable",
                reference_date=referenceDate,
            )
            return {
                "symbol": resolved["symbol"],
                "market": None,
                "events": [],
                **window,
                "attemptedSources": [],
                "providerErrors": [],
                "warnings": warnings,
                "qualityStatus": "unavailable",
                "coverageNotes": [
                    "Symbol market is unresolved; no cross-market blind search was attempted."
                ],
            }

        provider_ids = self._provider_ids(resolved["market"])
        if enabledProviders is not None:
            provider_ids = self._filter_provider_ids(provider_ids, enabledProviders)
        provider_ids = _filter_symbol_supported_providers(
            provider_ids, resolved["market"], resolved["symbol"]
        )

        if not provider_ids:
            window = evaluate_catalyst_window(
                [],
                lookahead_days=lookahead_days,
                lookback_days=lookback_days,
                provider_status="unavailable",
                reference_date=referenceDate,
            )
            return {
                "symbol": resolved["symbol"],
                "market": resolved["market"],
                "events": [],
                **window,
                "attemptedSources": [],
                "providerErrors": [],
                "warnings": warnings
                + [
                    _no_supported_provider_warning(
                        resolved["market"], resolved["symbol"]
                    )
                ],
                "qualityStatus": "unavailable",
                "coverageNotes": _coverage_notes(resolved["market"]),
            }

        search_result = await self._search_provider_references(
            provider_ids,
            query=query,
            symbol=resolved["symbol"],
            market=resolved["market"],
        )

        if (
            search_result["successfulProviderCount"] == 0
            and search_result["providerErrors"]
        ):
            raise RuntimeError(
                "All news catalyst providers failed: "
                + "; ".join(
                    f"{error['providerId']}: {error['message']}"
                    for error in search_result["providerErrors"]
                )
            )

        events = [
            _reference_to_event(reference, resolved["symbol"], resolved["market"])
            for reference in search_result["references"]
        ]
        provider_status = "degraded" if search_result["providerErrors"] else "available"
        window = evaluate_catalyst_window(
            events,
            lookahead_days=lookahead_days,
            lookback_days=lookback_days,
            provider_status=provider_status,
            reference_date=referenceDate,
        )

        return {
            "symbol": resolved["symbol"],
            "market": resolved["market"],
            "events": events,
            **window,
            "attemptedSources": search_result["attemptedSources"],
            "providerErrors": search_result["providerErrors"],
            "warnings": _dedupe(warnings + search_result["warnings"]),
            "qualityStatus": provider_status,
            "coverageNotes": _coverage_notes(resolved["market"]),
        }

    async def fetch_market_source(
        self,
        sourceId: str | None = None,
        url: str | None = None,
    ) -> dict[str, Any]:
        if not sourceId and not url:
            raise RuntimeError("fetch_market_source requires sourceId or url.")

        registered_reference = self.source_references.get(sourceId or "")
        if sourceId and registered_reference is None:
            raise RuntimeError(
                "Unknown sourceId; call search_announcements or search_news_catalysts before fetching by sourceId."
            )

        if registered_reference is not None:
            registered_url = str(registered_reference.get("url") or "")
            if url and url != registered_url:
                raise RuntimeError("fetch_market_source url does not match sourceId.")
            url = registered_url
            provider_id = str(registered_reference.get("providerId") or "unknown")
            title_hint = str(registered_reference.get("title") or sourceId or url)
        else:
            if not url:
                raise RuntimeError("fetch_market_source requires url.")
            provider_id = _provider_id_for_allowed_url(url)
            title_hint = sourceId or url

        allowed_provider_id = _provider_id_for_allowed_url(url)
        if provider_id != allowed_provider_id:
            raise RuntimeError(
                "fetch_market_source sourceId provider does not match url host."
            )

        fetched_at = _now_iso()
        body = await asyncio.to_thread(_fetch_url_bytes, url)
        content_hash = _content_hash(body)
        is_pdf = url.lower().split("?", 1)[0].endswith(".pdf")
        text = _extract_pdf_text(body) if is_pdf else _extract_text(body)
        title = _extract_title(text) or title_hint
        summary = _summarize_text(
            text,
            fallback=(
                f"Fetched PDF source metadata for {title}."
                if is_pdf
                else f"Fetched market source {title}."
            ),
        )
        resolved_source_id = sourceId or f"url:{content_hash}"
        parse_warnings = (
            [
                "PDF body was not parsed; only metadata/url/contentHash are evidence-ready."
            ]
            if is_pdf and not text
            else []
        )

        return {
            "contentHash": content_hash,
            "evidenceEligible": True,
            "fetchedAt": fetched_at,
            "provenance": [
                {
                    "fetchedAt": fetched_at,
                    "providerIds": [provider_id] if provider_id != "unknown" else [],
                    "qualityStatus": "warn" if parse_warnings else "pass",
                    "rowsUsed": 1,
                    "sourceId": resolved_source_id,
                    "warnings": parse_warnings,
                }
            ],
            "sourceId": resolved_source_id,
            "summary": summary,
            "textPreview": text[:2000] if text else "",
            "title": title,
            "url": url,
        }

    async def _search_provider_references(
        self,
        provider_ids: list[str],
        *,
        query: str,
        symbol: str,
        market: str,
    ) -> dict[str, Any]:
        attempted_sources: list[str] = []
        provider_errors: list[dict[str, str]] = []
        warnings: list[str] = []
        references: list[dict[str, Any]] = []
        successful_provider_count = 0

        for provider_id in provider_ids:
            provider = self.providers.get(provider_id)
            if provider is None:
                continue

            attempted_sources.append(provider_id)
            try:
                batch = await asyncio.to_thread(
                    provider.search_announcements,
                    symbol,
                    query,
                    market,
                )
            except Exception as error:
                provider_errors.append(
                    {"providerId": provider_id, "message": str(error)}
                )
                logger.warning(
                    "news_catalyst_provider_failed",
                    extra={
                        "provider": provider_id,
                        "market": market,
                        "detail": str(error),
                    },
                )
                continue

            successful_provider_count += 1
            references.extend(batch)
            if batch:
                break

        deduped = _dedupe_references(references)
        self._register_source_references(deduped)

        if "cninfo" in attempted_sources:
            warnings.append(
                "CNINFO front-end disclosure endpoint may change; adapter is best-effort."
            )

        return {
            "attemptedSources": attempted_sources,
            "providerErrors": provider_errors,
            "references": deduped,
            "successfulProviderCount": successful_provider_count,
            "warnings": warnings,
        }

    def _register_source_references(self, references: list[dict[str, Any]]) -> None:
        for reference in references:
            source_id = str(reference.get("sourceId") or "")
            url = str(reference.get("url") or "")
            if source_id and url:
                self.source_references[source_id] = dict(reference)


def _first_query_token(query: str) -> str:
    return (query.strip().split() or [""])[0]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _content_hash(body: bytes) -> str:
    return "sha256:" + hashlib.sha256(body).hexdigest()


def _reference_to_event(
    reference: dict[str, Any], symbol: str, market: str
) -> dict[str, Any]:
    classification = classify_catalyst(
        str(reference.get("title") or ""),
        reference.get("filingType")
        if isinstance(reference.get("filingType"), str)
        else None,
    )
    content_hash = _content_hash(
        "|".join(
            str(reference.get(key) or "")
            for key in ("providerId", "sourceId", "title", "publishedAt", "url")
        ).encode("utf-8")
    )

    return {
        "eventId": f"{reference.get('providerId')}:{symbol}:{reference.get('sourceId')}",
        "sourceId": reference.get("sourceId"),
        "providerId": reference.get("providerId"),
        "symbol": symbol,
        "market": market,
        "category": classification["category"],
        "title": reference.get("title"),
        "publishedAt": reference.get("publishedAt"),
        "eventDate": reference.get("eventDate"),
        "url": reference.get("url"),
        "confidence": classification["confidence"],
        "credibilityStatus": reference.get("credibilityStatus", "unknown"),
        "snippet": reference.get("snippet", ""),
        "fetchedAt": _now_iso(),
        "contentHash": content_hash,
        "evidenceEligible": False,
    }


def _dedupe_references(references: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    seen_title_keys: set[tuple[str, str, str]] = set()

    for reference in references:
        provider_url_key = (str(reference.get("providerId")), str(reference.get("url")))
        title_key = (
            str(reference.get("providerId")),
            str(reference.get("publishedAt")),
            re.sub(r"\s+", " ", str(reference.get("title") or "").lower()).strip(),
        )

        if provider_url_key in seen or title_key in seen_title_keys:
            continue

        seen.add(provider_url_key)
        seen_title_keys.add(title_key)
        deduped.append(reference)

    return deduped


def _dedupe(values: list[str]) -> list[str]:
    deduped: list[str] = []
    seen: set[str] = set()
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        deduped.append(value)
    return deduped


def _coverage_notes(market: str | None) -> list[str]:
    if market == "A":
        return [
            "A-share disclosures use CNINFO primary and Eastmoney notice fallback; SSE disclosure is planned."
        ]
    if market == "HK":
        return [
            "HK issuer disclosures use HKEXnews; HSTECH index notices use Hang Seng Indexes media-room JSON."
        ]
    if market == "US":
        return [
            "SEC EDGAR submissions metadata only; full-text EFTS search is planned."
        ]
    return []


def _is_unsupported_index_request(market: str | None, symbol: str) -> bool:
    return market == "HK" and not re.fullmatch(r"\d{1,5}", symbol)


def _filter_symbol_supported_providers(
    provider_ids: list[str], market: str | None, symbol: str
) -> list[str]:
    return [
        provider_id
        for provider_id in provider_ids
        if _provider_supports_symbol(provider_id, market, symbol)
    ]


def _provider_supports_symbol(
    provider_id: str, market: str | None, symbol: str
) -> bool:
    if market == "HK" and provider_id == "hkexnews":
        return not _is_unsupported_index_request(market, symbol)
    if market == "HK" and provider_id == "hsi_index_notices":
        return _is_supported_hsi_index_symbol(symbol)
    return True


def _is_supported_hsi_index_symbol(symbol: str) -> bool:
    normalized = symbol.strip().upper().removeprefix("^")
    normalized = normalized.removesuffix(".HK").replace(" ", "")
    return normalized in {"HSTECH", "HANGSENGTECH"} or "恒生科技" in symbol


def _no_supported_provider_warning(market: str | None, symbol: str) -> str:
    if _is_unsupported_index_request(market, symbol):
        return f"{symbol} is not a numeric HK issuer code; enable hsi_index_notices or pass a supported Hang Seng index symbol."
    return "No enabled news catalyst providers for resolved market."


class _NoRedirectHandler(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[no-untyped-def]
        return None


def _provider_id_for_allowed_url(url: str) -> str:
    parsed = parse.urlparse(url)
    if parsed.scheme.lower() != "https":
        raise RuntimeError("fetch_market_source only supports https URLs.")
    if parsed.username or parsed.password:
        raise RuntimeError("fetch_market_source URLs must not include credentials.")
    if parsed.port not in (None, 443):
        raise RuntimeError("fetch_market_source only supports the default https port.")

    host = (parsed.hostname or "").lower().rstrip(".")
    if not host:
        raise RuntimeError("fetch_market_source URL host is missing.")

    for provider_id, suffixes in ALLOWED_FETCH_HOSTS.items():
        if any(host == suffix or host.endswith(f".{suffix}") for suffix in suffixes):
            _reject_private_host(host)
            return provider_id

    raise RuntimeError(
        "fetch_market_source URL host is not an allowed disclosure host."
    )


def _reject_private_host(host: str) -> None:
    try:
        addresses = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise RuntimeError(
            "fetch_market_source URL host could not be resolved."
        ) from exc

    for address in addresses:
        ip_address = ipaddress.ip_address(address[4][0])
        if (
            ip_address.is_private
            or ip_address.is_loopback
            or ip_address.is_link_local
            or ip_address.is_multicast
            or ip_address.is_reserved
            or ip_address.is_unspecified
        ):
            raise RuntimeError(
                "fetch_market_source URL host resolves to a private address."
            )


def _fetch_url_bytes(url: str) -> bytes:
    _provider_id_for_allowed_url(url)
    req = request.Request(
        url,
        headers={"User-Agent": "QuantDesk/0.1 disclosure-fetch"},
    )
    opener = request.build_opener(_NoRedirectHandler)
    try:
        with opener.open(req, timeout=15) as response:
            final_url = response.geturl()
            if _provider_id_for_allowed_url(final_url) != _provider_id_for_allowed_url(
                url
            ):
                raise RuntimeError(
                    "fetch_market_source redirect changed provider host."
                )
            body = response.read(MAX_FETCH_BYTES + 1)
    except error.HTTPError as exc:
        if 300 <= exc.code < 400:
            raise RuntimeError(
                "fetch_market_source redirects are not followed."
            ) from exc
        raise

    if len(body) > MAX_FETCH_BYTES:
        raise RuntimeError("fetch_market_source response is too large.")
    return body


def _extract_text(body: bytes) -> str:
    raw = body.decode("utf-8", errors="replace")
    cleaned = re.sub(r"<script[\s\S]*?</script>", " ", raw, flags=re.IGNORECASE)
    cleaned = re.sub(r"<style[\s\S]*?</style>", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"<[^>]+>", " ", cleaned)
    return re.sub(r"\s+", " ", unescape(cleaned)).strip()


def _extract_pdf_text(body: bytes) -> str:
    try:
        reader = PdfReader(BytesIO(body))
    except Exception:
        return ""

    page_texts: list[str] = []
    for page in reader.pages[:8]:
        try:
            page_text = page.extract_text() or ""
        except Exception:
            page_text = ""
        if page_text:
            page_texts.append(page_text)

    return re.sub(r"\s+", " ", " ".join(page_texts)).strip()


def _extract_title(text: str) -> str | None:
    return text[:120].strip() or None


def _summarize_text(text: str, *, fallback: str) -> str:
    if not text:
        return fallback
    return text[:500]
