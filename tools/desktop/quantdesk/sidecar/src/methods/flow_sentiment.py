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
    NORTHBOUND_CAVEAT,
    classify_provider_error,
    dedupe,
    disabled_until,
    empty_flow_result,
    normalize_market,
    provider_order,
    provenance,
)


class FlowSentimentMethods:
    def __init__(self) -> None:
        self.policy = load_research_provider_policy()
        self.providers = {
            "akshare": AKShareResearchProvider(),
            "tushare": TuShareResearchProvider(),
            "yfinance": YFinanceResearchProvider(),
        }
        self.disabled_until_by_provider: dict[str, str] = {}

    async def fetch_flow_sentiment(
        self,
        symbol: str | None = None,
        market: str | None = None,
        enabledProviders: list[str] | None = None,
        assetMetadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        normalized_market = normalize_market(market)
        if normalized_market is None:
            return empty_flow_result(
                attempted_sources=[],
                market=None,
                provider_errors=[],
                symbol=symbol,
                warnings=["Flow/sentiment request requires a resolved market."],
            )

        provider_ids = provider_order(
            self.policy["flowSentimentProviderOrder"],
            self.policy["providerStatus"],
            normalized_market,
            enabledProviders,
        )
        if not provider_ids:
            return empty_flow_result(
                attempted_sources=[],
                market=normalized_market,
                provider_errors=[],
                symbol=symbol,
                warnings=["No enabled flow/sentiment providers for resolved market."],
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
        symbol: str | None,
        market: str,
        asset_metadata: dict[str, Any] | None,
    ) -> dict[str, Any]:
        attempted_sources: list[str] = []
        provider_errors: list[dict[str, Any]] = []
        warnings: list[str] = []

        for provider_id in provider_ids:
            disabled_until_value = self._disabled_until(provider_id)
            if disabled_until_value is not None:
                warnings.append(f"{provider_id} is temporarily disabled until {disabled_until_value}.")
                continue

            provider = self.providers.get(provider_id)
            if provider is None:
                continue

            attempted_sources.append(provider_id)
            try:
                result = await asyncio.to_thread(
                    provider.fetch_flow_sentiment,
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

            result = _apply_northbound_caveat(result)
            quality_status = str(result.get("qualityStatus") or "degraded")
            return {
                **result,
                "attemptedSources": attempted_sources,
                "dataProvenance": [
                    provenance(
                        kind="flow_sentiment",
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

        return empty_flow_result(
            attempted_sources=attempted_sources,
            market=market,
            provider_errors=provider_errors,
            symbol=symbol,
            warnings=dedupe(warnings or ["No flow/sentiment provider returned usable signals."]),
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
            disabled = disabled_until(self.policy["freshness"]["providerPermissionBackoffHours"])
            self.disabled_until_by_provider[provider_id] = disabled
            payload["disabledUntil"] = disabled
        return payload


def _apply_northbound_caveat(result: dict[str, Any]) -> dict[str, Any]:
    signals = dict(result.get("signals") or {})
    flow = dict(signals.get("flow") or {})
    if flow:
        flow.setdefault("northboundNetInflow", None)
        flow.setdefault("northboundAvailabilityCaveat", NORTHBOUND_CAVEAT)
        signals["flow"] = flow
    return {**result, "signals": signals}