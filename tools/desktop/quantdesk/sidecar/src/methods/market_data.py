from __future__ import annotations

import asyncio
from datetime import date
import logging
from typing import Any

from adapters.akshare import AKShareAdapter
from adapters.frankfurter_adapter import FrankfurterAdapter
from adapters.tushare_adapter import TuShareAdapter
from adapters.yfinance_adapter import YFinanceAdapter
from contracts import load_market_data_policy

from ._market_data.merge import (
    is_filled_by,
    merge_fx_row,
    merge_price_row,
    price_completeness,
)
from ._market_data.policy import (
    filter_provider_ids,
    fx_provider_ids,
    has_only_lower_priority_price_providers,
    market_policy_key,
    price_provider_ids,
    search_provider_ids,
    source_priority,
)
from ._market_data.prices import (
    last_business_day_on_or_before,
    price_rows_cover_window,
)
from ._market_data.search import (
    ASSET_SEARCH_RESULT_LIMIT,
    dedupe_asset_results,
    normalize_market,
)
from ._market_data.types import (
    AssetSearchResult,
    FxFetchResult,
    FxRateRow,
    PriceFetchResult,
    PriceRow,
)


logger = logging.getLogger(__name__)

__all__ = [
    "AssetSearchResult",
    "FxFetchResult",
    "FxRateRow",
    "MarketDataMethods",
    "PriceFetchResult",
    "PriceRow",
]


class MarketDataMethods:
    def __init__(self) -> None:
        self.akshare = AKShareAdapter()
        self.frankfurter = FrankfurterAdapter()
        self.tushare = TuShareAdapter()
        self.yfinance = YFinanceAdapter()
        self.policy = load_market_data_policy()
        self.providers = {
            "akshare": self.akshare,
            "frankfurter": self.frankfurter,
            "tushare": self.tushare,
            "yfinance": self.yfinance,
        }

    def _market_policy_key(self, market: str | None) -> str:
        return market_policy_key(market)

    def _search_provider_ids(self, market: str | None) -> list[str]:
        return search_provider_ids(self.policy, market)

    def _filter_provider_ids(
        self, provider_ids: list[str], enabled_sources: list[str]
    ) -> list[str]:
        return filter_provider_ids(provider_ids, enabled_sources)

    def _price_provider_ids(self, symbol: str, market: str | None) -> list[str]:
        return price_provider_ids(self.policy, symbol, market)

    def _has_only_lower_priority_price_providers(
        self,
        provider_id: str,
        remaining_provider_ids: list[str],
        market: str | None,
    ) -> bool:
        return has_only_lower_priority_price_providers(
            self.policy,
            provider_id,
            remaining_provider_ids,
            market,
        )

    def _price_rows_cover_window(
        self, prices: list[dict[str, Any]], start: str, end: str
    ) -> bool:
        return price_rows_cover_window(prices, start, end)

    def _last_business_day_on_or_before(self, value: date) -> date:
        return last_business_day_on_or_before(value)

    def _fx_provider_ids(self) -> list[str]:
        return fx_provider_ids(self.policy)

    def _source_priority(self, source: str, *, market: str | None, kind: str) -> float:
        return source_priority(self.policy, source, market=market, kind=kind)

    def _price_completeness(self, row: dict[str, Any]) -> int:
        return price_completeness(row)

    def _is_filled_by(self, existing: dict[str, Any], incoming: dict[str, Any]) -> bool:
        return is_filled_by(existing, incoming)

    def _merge_price_row(
        self,
        existing: dict[str, Any] | None,
        incoming: dict[str, Any],
        market: str | None,
    ) -> dict[str, Any]:
        return merge_price_row(self.policy, existing, incoming, market)

    def _merge_fx_row(
        self, existing: dict[str, Any] | None, incoming: dict[str, Any]
    ) -> dict[str, Any]:
        return merge_fx_row(self.policy, existing, incoming)

    def _dedupe_warnings(self, warnings: list[str]) -> list[str]:
        deduped: list[str] = []
        seen: set[str] = set()

        for warning in warnings:
            if warning in seen:
                continue
            seen.add(warning)
            deduped.append(warning)

        return deduped

    async def search_assets(
        self,
        query: str,
        market: str | None = None,
        enabledSources: list[str] | None = None,
    ) -> list[AssetSearchResult]:
        if not query.strip():
            return []

        market = normalize_market(market)

        provider_ids = self._search_provider_ids(market)
        if enabledSources is not None:
            provider_ids = self._filter_provider_ids(provider_ids, enabledSources)
        if not provider_ids:
            raise RuntimeError("No market data providers are enabled for asset search.")

        providers = [self.providers[provider_id] for provider_id in provider_ids]
        results = await asyncio.gather(
            *[
                asyncio.to_thread(provider.search_assets, query, market)
                for provider in providers
            ],
            return_exceptions=True,
        )
        merged: list[dict[str, object]] = []
        provider_errors: list[str] = []

        for provider_id, batch in zip(provider_ids, results):
            if isinstance(batch, Exception):
                provider_errors.append(f"{provider_id}: {batch}")
                logger.warning(
                    "search_provider_failed",
                    extra={
                        "provider": provider_id,
                        "market": market,
                        "queryLength": len(query),
                        "detail": str(batch),
                    },
                )
                continue

            merged.extend(batch)

        if not merged and provider_errors:
            raise RuntimeError(
                "All asset search providers failed: " + "; ".join(provider_errors)
            )

        deduped = dedupe_asset_results(merged, query)

        if not deduped:
            logger.info(
                "search_assets_no_results",
                extra={
                    "market": market,
                    "providerCount": len(providers),
                    "providers": provider_ids,
                    "queryLength": len(query),
                },
            )

        return deduped[:ASSET_SEARCH_RESULT_LIMIT]

    async def fetch_prices(
        self,
        symbol: str,
        start: str,
        end: str,
        market: str | None = None,
        enabledSources: list[str] | None = None,
        assetMetadata: dict[str, object] | None = None,
    ) -> PriceFetchResult:
        provider_ids = self._price_provider_ids(symbol, market)
        if enabledSources is not None:
            provider_ids = self._filter_provider_ids(provider_ids, enabledSources)
        if not provider_ids:
            raise RuntimeError("No market data providers are enabled for price sync.")

        attempted_sources: list[str] = []
        warnings: list[str] = []
        merged_by_date: dict[str, dict[str, Any]] = {}

        for provider_index, provider_id in enumerate(provider_ids):
            attempted_sources.append(provider_id)
            response = await asyncio.to_thread(
                self.providers[provider_id].fetch_prices,
                symbol,
                start,
                end,
                market,
                assetMetadata,
            )
            warnings.extend(response.get("warnings", []))
            prices = response.get("prices", [])

            for row in prices:
                date_key = str(row["date"])
                merged_by_date[date_key] = self._merge_price_row(
                    merged_by_date.get(date_key),
                    row,
                    market,
                )

            if (
                prices
                and provider_id == "akshare"
                and any(row.get("source") == "akshare-hk-index-em" for row in prices)
            ):
                break

            if (
                prices
                and provider_id == "tushare"
                and self._has_only_lower_priority_price_providers(
                    provider_id,
                    provider_ids[provider_index + 1 :],
                    market,
                )
            ):
                break

            if self._price_rows_cover_window(
                prices, start, end
            ) and self._has_only_lower_priority_price_providers(
                provider_id,
                provider_ids[provider_index + 1 :],
                market,
            ):
                break

        if not merged_by_date:
            warnings.append(f"No real price data available for {symbol}.")

        return {
            "symbol": symbol,
            "prices": [merged_by_date[key] for key in sorted(merged_by_date)],
            "attemptedSources": attempted_sources,
            "warnings": self._dedupe_warnings(warnings),
        }

    async def fetch_fx_rates(
        self,
        pair: str,
        start: str,
        end: str,
        enabledSources: list[str] | None = None,
    ) -> FxFetchResult:
        provider_ids = self._fx_provider_ids()
        if enabledSources is not None:
            provider_ids = self._filter_provider_ids(provider_ids, enabledSources)
        if not provider_ids:
            raise RuntimeError("No FX data providers are enabled.")

        attempted_sources: list[str] = []
        warnings: list[str] = []
        merged_by_date: dict[str, dict[str, Any]] = {}

        for provider_id in provider_ids:
            attempted_sources.append(provider_id)
            response = await asyncio.to_thread(
                self.providers[provider_id].fetch_fx_rates,
                pair,
                start,
                end,
            )
            warnings.extend(response.get("warnings", []))

            for row in response.get("rates", []):
                date_key = str(row["date"])
                merged_by_date[date_key] = self._merge_fx_row(
                    merged_by_date.get(date_key),
                    row,
                )

        if not merged_by_date:
            warnings.append(f"No real FX data available for {pair}.")

        return {
            "pair": pair,
            "rates": [merged_by_date[key] for key in sorted(merged_by_date)],
            "attemptedSources": attempted_sources,
            "warnings": self._dedupe_warnings(warnings),
        }
