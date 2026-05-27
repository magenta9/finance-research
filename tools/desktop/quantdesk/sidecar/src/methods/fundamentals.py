from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

from adapters.research_providers import (
    AKShareResearchProvider,
    TuShareResearchProvider,
    YFinanceResearchProvider,
)
from contracts import load_research_provider_policy

from ._research_providers.common import (
    classify_provider_error,
    dedupe,
    disabled_until,
    empty_fundamentals_result,
    fund_facts_result,
    is_a_market_fund_or_etf,
    normalize_market,
    provider_order,
    provenance,
)


class FundamentalsMethods:
    def __init__(self) -> None:
        self.policy = load_research_provider_policy()
        self.providers = {
            "akshare": AKShareResearchProvider(),
            "tushare": TuShareResearchProvider(),
            "yfinance": YFinanceResearchProvider(),
        }
        self.disabled_until_by_provider: dict[str, str] = {}

    async def fetch_fundamentals(
        self,
        symbol: str,
        market: str | None = None,
        enabledProviders: list[str] | None = None,
        assetMetadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        normalized_market = normalize_market(market)
        if not symbol or normalized_market is None:
            return empty_fundamentals_result(
                attempted_sources=[],
                market=normalized_market,
                provider_errors=[],
                symbol=symbol or "",
                warnings=[
                    "Fundamentals request requires a resolved market and symbol."
                ],
            )

        if normalized_market == "A" and is_a_market_fund_or_etf(symbol, assetMetadata):
            result = fund_facts_result(
                "asset_metadata", symbol, normalized_market, assetMetadata
            )
            result_warnings = list(result.get("warnings") or [])
            valuation_provenance = []
            provider_ids = provider_order(
                self.policy["fundamentalsProviderOrder"],
                self.policy["providerStatus"],
                normalized_market,
                enabledProviders,
            )
            if "akshare" in provider_ids:
                try:
                    valuation_result = await asyncio.to_thread(
                        self.providers["akshare"].fetch_underlying_index_valuation,
                        symbol,
                        normalized_market,
                        assetMetadata,
                    )
                    underlying_valuation = valuation_result.get("underlyingValuation")
                    if isinstance(underlying_valuation, dict):
                        result["metrics"]["fundFacts"]["underlyingValuation"] = (
                            underlying_valuation
                        )
                    valuation_warnings = list(valuation_result.get("warnings") or [])
                    result_warnings.extend(valuation_warnings)
                    if bool(valuation_result.get("providerAttempted")):
                        valuation_provenance.append(
                            provenance(
                                kind="fundamentals",
                                provider_id="akshare",
                                quality_status="available"
                                if not valuation_warnings
                                else "degraded",
                                rows_used=int(valuation_result.get("rowsUsed") or 0),
                                symbol=symbol,
                                warnings=valuation_warnings,
                            )
                        )
                except Exception as error:
                    result_warnings.append(
                        f"akshare underlying index valuation failed: {error}"
                    )
            return {
                **result,
                "attemptedSources": ["akshare"] if valuation_provenance else [],
                "dataProvenance": [
                    provenance(
                        kind="fundamentals",
                        provider_id="asset_metadata",
                        quality_status="degraded",
                        rows_used=0,
                        symbol=symbol,
                        warnings=result_warnings,
                    )
                ]
                + valuation_provenance,
                "providerErrors": [],
                "warnings": dedupe(result_warnings),
            }

        provider_ids = provider_order(
            self.policy["fundamentalsProviderOrder"],
            self.policy["providerStatus"],
            normalized_market,
            enabledProviders,
        )
        if not provider_ids:
            return empty_fundamentals_result(
                attempted_sources=[],
                market=normalized_market,
                provider_errors=[],
                symbol=symbol,
                warnings=["No enabled fundamentals providers for resolved market."],
            )

        return await self._fetch_from_providers(
            provider_ids,
            symbol=symbol,
            market=normalized_market,
            asset_metadata=assetMetadata,
        )

    async def _fetch_from_providers(
        self,
        provider_ids: list[str],
        *,
        symbol: str,
        market: str,
        asset_metadata: dict[str, Any] | None,
    ) -> dict[str, Any]:
        attempted_sources: list[str] = []
        provider_errors: list[dict[str, Any]] = []
        warnings: list[str] = []

        for provider_id in provider_ids:
            disabled_until_value = self._disabled_until(provider_id)
            if disabled_until_value is not None:
                warnings.append(
                    f"{provider_id} is temporarily disabled until {disabled_until_value}."
                )
                continue

            provider = self.providers.get(provider_id)
            if provider is None:
                continue

            attempted_sources.append(provider_id)
            try:
                result = await asyncio.to_thread(
                    provider.fetch_fundamentals,
                    symbol,
                    market,
                    asset_metadata,
                )
            except Exception as error:
                provider_errors.append(self._provider_error(provider_id, error))
                continue

            result_warnings = list(result.get("warnings") or [])
            warnings.extend(result_warnings)
            if result.get("qualityStatus") == "unavailable":
                continue

            quality_status = str(result.get("qualityStatus") or "degraded")
            return {
                **result,
                "attemptedSources": attempted_sources,
                "dataProvenance": [
                    provenance(
                        kind="fundamentals",
                        provider_id=provider_id,
                        quality_status=quality_status,
                        rows_used=int(result.get("rowsUsed") or 0),
                        symbol=symbol,
                        warnings=result_warnings,
                    )
                ],
                "providerErrors": provider_errors,
                "warnings": dedupe(warnings),
            }

        return empty_fundamentals_result(
            attempted_sources=attempted_sources,
            market=market,
            provider_errors=provider_errors,
            symbol=symbol,
            warnings=dedupe(
                warnings or ["No fundamentals provider returned usable metrics."]
            ),
        )

    def _disabled_until(self, provider_id: str) -> str | None:
        value = self.disabled_until_by_provider.get(provider_id)
        if value is None:
            return None
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed <= datetime.now(timezone.utc):
            del self.disabled_until_by_provider[provider_id]
            return None
        return value

    def _provider_error(self, provider_id: str, error: Exception) -> dict[str, Any]:
        error_type = classify_provider_error(error)
        payload: dict[str, Any] = {
            "errorType": error_type,
            "message": str(error),
            "providerId": provider_id,
        }
        if error_type in {"permission", "rate_limit"}:
            disabled = disabled_until(
                self.policy["freshness"]["providerPermissionBackoffHours"]
            )
            self.disabled_until_by_provider[provider_id] = disabled
            payload["disabledUntil"] = disabled
        return payload
