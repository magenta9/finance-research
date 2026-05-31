from __future__ import annotations

import math
from typing import Any

from eval_core.contract import FinalScoreSpec, MetricScoringSpec, ScoringProfile


def clamp(value: float, lower: float = 0.0, upper: float = 1.0) -> float:
    return min(upper, max(lower, value))


def score_component(value: float, floor: float, ceiling: float) -> float:
    if ceiling <= floor:
        raise ValueError(f"Invalid score bounds: floor={floor}, ceiling={ceiling}")
    return clamp((value - floor) / (ceiling - floor))


def metric_component(
    value: float, spec: MetricScoringSpec, *, drawdown_ceiling: float | None = None
) -> float:
    if spec.direction == "lower_better":
        ceiling = spec.ceiling if spec.ceiling is not None else drawdown_ceiling
        if ceiling is None or ceiling <= 0:
            raise ValueError(f"Missing ceiling for lower-better metric {spec.key}")
        return clamp(1 - abs(value) / ceiling)
    floor = spec.floor if spec.floor is not None else 0.0
    ceiling = spec.ceiling if spec.ceiling is not None else 1.0
    return score_component(value, floor, ceiling)


def score_result(metrics: dict[str, Any], profile: ScoringProfile) -> float:
    if not profile.metrics:
        raise ValueError("Scoring profile must define at least one metric.")
    components: list[tuple[float, float]] = []
    for spec in profile.metrics:
        raw = metrics.get(spec.key)
        if spec.key == "sharpe" and raw is None:
            raw = metrics.get("sharpeRatio")
        value = float(raw or 0)
        components.append((spec.weight, metric_component(value, spec)))
    weight_total = sum(weight for weight, _ in components)
    if weight_total <= 0:
        raise ValueError("At least one scoring weight must be positive.")
    score = 100 * sum(
        weight / weight_total * component for weight, component in components
    )
    return round(score, 4)


def percentile(sorted_values: list[float], ratio: float) -> float | None:
    if not sorted_values:
        return None
    index = min(
        len(sorted_values) - 1, max(0, math.floor((len(sorted_values) - 1) * ratio))
    )
    return round(sorted_values[index], 4)


def final_score(summary: dict[str, Any], spec: FinalScoreSpec) -> float | None:
    p10 = summary.get("p10Score")
    p50 = summary.get("p50Score")
    p90 = summary.get("p90Score")
    if not all(isinstance(value, (int, float)) for value in [p10, p50, p90]):
        return None
    return round(
        spec.p10_weight * float(p10)
        + spec.p50_weight * float(p50)
        + spec.p90_weight * float(p90),
        4,
    )


def summarize_failures(failed: list[dict[str, Any]]) -> dict[str, Any]:
    error_counts: dict[str, int] = {}
    for row in failed:
        message = str(row.get("error") or "unknown error")
        error_counts[message] = error_counts.get(message, 0) + 1
    samples = [
        {
            "basketSize": row.get("basketSize"),
            "caseId": row.get("caseId"),
            "error": row.get("error"),
            "rebalanceCadence": row.get("rebalanceCadence"),
            "sampleIndex": row.get("sampleIndex"),
            "strategyId": row.get("strategyId"),
            "symbols": row.get("symbols"),
            "windowYears": row.get("windowYears"),
        }
        for row in failed[:8]
    ]
    return {
        "errorCounts": dict(
            sorted(error_counts.items(), key=lambda item: item[1], reverse=True)
        ),
        "samples": samples,
    }


def summarize_scores(
    rows: list[dict[str, Any]], profile: ScoringProfile
) -> dict[str, Any]:
    successful = [
        row
        for row in rows
        if row.get("status") == "ok" and isinstance(row.get("score"), (int, float))
    ]
    failed = [row for row in rows if row.get("status") != "ok"]
    scores = sorted(float(row["score"]) for row in successful)
    summary = {
        "allCasesSucceeded": len(failed) == 0 and len(rows) > 0,
        "caseCount": len(rows),
        "failureCount": len(failed),
        "meanScore": round(sum(scores) / len(scores), 4) if scores else None,
        "p10Score": percentile(scores, 0.1),
        "p50Score": percentile(scores, 0.5),
        "p90Score": percentile(scores, 0.9),
        "successCount": len(successful),
    }
    if profile.require_all_cases_succeeded and not summary["allCasesSucceeded"]:
        return {
            **summary,
            "failureDiagnostics": summarize_failures(failed),
            "finalScore": None,
            "meanScore": None,
            "p10Score": None,
            "p50Score": None,
            "p90Score": None,
            "scoreComparable": False,
        }
    return {
        **summary,
        "finalScore": final_score(summary, profile.final_score),
        "scoreComparable": True,
    }


def score_rows(
    rows: list[dict[str, Any]], profile: ScoringProfile
) -> list[dict[str, Any]]:
    scored: list[dict[str, Any]] = []
    for row in rows:
        if row.get("status") == "ok" and isinstance(row.get("metrics"), dict):
            row = {**row, "score": score_result(row["metrics"], profile)}
        scored.append(row)
    return scored


def summarize_by_strategy(
    rows: list[dict[str, Any]], profile: ScoringProfile
) -> dict[str, Any]:
    strategy_ids = sorted({str(row.get("strategyId")) for row in rows if row.get("strategyId")})
    by_strategy = {
        strategy_id: summarize_scores(
            [row for row in rows if row.get("strategyId") == strategy_id],
            profile,
        )
        for strategy_id in strategy_ids
    }
    leaderboard = sorted(
        [{"strategyId": strategy_id, **summary} for strategy_id, summary in by_strategy.items()],
        key=lambda row: (
            row["finalScore"] if isinstance(row.get("finalScore"), (int, float)) else -1
        ),
        reverse=True,
    )
    return {
        "byStrategy": by_strategy,
        "leaderboard": leaderboard,
        "overall": summarize_scores(rows, profile),
    }
