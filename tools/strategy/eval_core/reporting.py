from __future__ import annotations

import csv
from pathlib import Path
from typing import Any

from eval_core.contract import ScoringProfile


def describe_scoring_profile(profile: ScoringProfile) -> str:
    weight_total = sum(spec.weight for spec in profile.metrics)
    if weight_total <= 0:
        return "No active scoring weights."
    active = [
        f"{spec.key} {spec.weight / weight_total:.0%}"
        for spec in profile.metrics
        if spec.weight > 0
    ]
    return ", ".join(active) + "."


def write_tsv(path: Path, rows: list[dict[str, Any]], extra_fields: list[str] | None = None) -> None:
    fields = [
        "caseId",
        "status",
        "strategyId",
        "rebalanceCadence",
        "basketSize",
        "windowYears",
        "sampleIndex",
        "startDate",
        "endDate",
        "symbols",
        "score",
        "expectedReturn",
        "volatility",
        "sharpeRatio",
        "maxDrawdown",
        "rebalanceEventCount",
        "error",
    ]
    for field in extra_fields or []:
        if field not in fields:
            fields.insert(-1, field)
    with path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(
            file,
            fieldnames=fields,
            delimiter="\t",
            extrasaction="ignore",
            lineterminator="\n",
        )
        writer.writeheader()
        for row in rows:
            metrics = row.get("metrics") or {}
            metadata = row.get("metadata") or {}
            error = row.get("error")
            writer.writerow(
                {
                    **row,
                    **metadata,
                    "error": error if error else "-",
                    "expectedReturn": metrics.get("expectedReturn"),
                    "maxDrawdown": metrics.get("maxDrawdown"),
                    "sharpeRatio": metrics.get("sharpeRatio"),
                    "symbols": ",".join(row.get("symbols") or []),
                    "volatility": metrics.get("volatility"),
                }
            )


def write_report(
    path: Path,
    summary: dict[str, Any],
    plan: dict[str, Any],
    *,
    profile: ScoringProfile,
) -> None:
    lines = [
        "# Strategy Eval",
        "",
        f"- Data source: {plan.get('dataSource', 'quant-data-cli')}",
        f"- Strategies: {', '.join(plan.get('strategies', []))}",
        f"- Cases: {plan.get('caseCount', summary.get('overall', {}).get('caseCount'))}",
        f"- End date: {plan.get('endDate')}",
        f"- Seed: {plan.get('seed')}",
        "",
        "## Leaderboard",
        "",
        "| Strategy | Final | P10 | P50 | P90 | Mean | Success | Failure |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for row in summary.get("leaderboard", []):
        lines.append(
            f"| {row['strategyId']} | {row.get('finalScore')} | {row.get('p10Score')} | "
            f"{row.get('p50Score')} | {row.get('p90Score')} | {row.get('meanScore')} | "
            f"{row.get('successCount')} | {row.get('failureCount')} |"
        )
    overall = summary.get("overall") or {}
    if overall.get("failureCount", 0) > 0:
        lines.extend(["", "## Failures", ""])
        lines.append(
            f"- Not score-comparable: {overall.get('successCount')}/{overall.get('caseCount')} cases succeeded."
        )
        diagnostics = overall.get("failureDiagnostics") or {}
        for message, count in (diagnostics.get("errorCounts") or {}).items():
            lines.append(f"- `{count}` × {message}")
    final = profile.final_score
    lines.extend(
        [
            "",
            f"Final score formula: `{final.p50_weight} * p50 + {final.p10_weight} * p10 + {final.p90_weight} * p90`.",
            "Scores are emitted only when every case succeeds when `requireAllCasesSucceeded` is true.",
            f"Single-case score formula: {describe_scoring_profile(profile)}",
        ]
    )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
