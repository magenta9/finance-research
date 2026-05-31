from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

CANONICAL_STRATEGY_IDS = (
    "active_dual_momentum_gtaa",
    "erc",
    "ewmac_trend_following",
    "inverse_volatility",
    "max_diversification",
    "max_diversification_research_v1",
)


@dataclass(frozen=True)
class MetricScoringSpec:
    key: str
    weight: float
    direction: Literal["higher_better", "lower_better"]
    floor: float | None = None
    ceiling: float | None = None


@dataclass(frozen=True)
class FinalScoreSpec:
    p10_weight: float = 0.25
    p50_weight: float = 0.5
    p90_weight: float = 0.25


@dataclass(frozen=True)
class ScoringProfile:
    metrics: tuple[MetricScoringSpec, ...]
    final_score: FinalScoreSpec = FinalScoreSpec()
    require_all_cases_succeeded: bool = True


@dataclass(frozen=True)
class StrategyRunSpec:
    strategy_id: str
    strategy_mix: dict[str, Any] = field(default_factory=dict)
    constraints: dict[str, Any] | None = None
    extra_result_fields: tuple[str, ...] = ()


@dataclass(frozen=True)
class EvalCase:
    case_id: str
    symbols: list[str]
    start_date: str
    end_date: str
    basket_size: int
    window_years: int
    sample_index: int
    rebalance_cadence: str | None = None
    asset_ids: list[str] = field(default_factory=list)
    skip_reason: str | None = None


@dataclass(frozen=True)
class EvalRunRequest:
    base_currency: str
    assets: list[dict[str, Any]]
    cases: list[EvalCase]
    prices_by_symbol: dict[str, Any]
    strategy_runs: list[StrategyRunSpec]
    default_constraints: dict[str, Any]
    run_id: str | None = None


def scoring_profile_from_dict(payload: dict[str, Any]) -> ScoringProfile:
    metrics = tuple(
        MetricScoringSpec(
            key=str(item["key"]),
            weight=float(item["weight"]),
            direction=item.get("direction", "higher_better"),
            floor=item.get("floor"),
            ceiling=item.get("ceiling"),
        )
        for item in payload.get("metrics", [])
    )
    final_payload = payload.get("finalScore") or {}
    return ScoringProfile(
        metrics=metrics,
        final_score=FinalScoreSpec(
            p10_weight=float(final_payload.get("p10Weight", 0.25)),
            p50_weight=float(final_payload.get("p50Weight", 0.5)),
            p90_weight=float(final_payload.get("p90Weight", 0.25)),
        ),
        require_all_cases_succeeded=bool(
            payload.get("requireAllCasesSucceeded", True)
        ),
    )


def eval_run_request_to_payload(request: EvalRunRequest) -> dict[str, Any]:
    return {
        "baseCurrency": request.base_currency,
        "assets": request.assets,
        "cases": [
            {
                "caseId": case.case_id,
                "symbols": case.symbols,
                "startDate": case.start_date,
                "endDate": case.end_date,
                "basketSize": case.basket_size,
                "windowYears": case.window_years,
                "sampleIndex": case.sample_index,
                **({"rebalanceCadence": case.rebalance_cadence} if case.rebalance_cadence else {}),
                **({"assetIds": case.asset_ids} if case.asset_ids else {}),
                **({"skipReason": case.skip_reason} if case.skip_reason else {}),
            }
            for case in request.cases
        ],
        "defaultConstraints": request.default_constraints,
        "pricesBySymbol": request.prices_by_symbol,
        "strategyRuns": [
            {
                "strategyId": run.strategy_id,
                "strategyMix": run.strategy_mix,
                **({"constraints": run.constraints} if run.constraints else {}),
                **(
                    {"extraResultFields": list(run.extra_result_fields)}
                    if run.extra_result_fields
                    else {}
                ),
            }
            for run in request.strategy_runs
        ],
    }
