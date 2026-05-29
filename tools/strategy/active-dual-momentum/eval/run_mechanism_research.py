#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from eval_lib import (
    DEFAULT_OUTPUT_ROOT,
    create_run_dir,
    summarize_scores,
    write_json,
)
from eval_context import resolve_eval_config_context
from run_eval import (
    asset_candidate_to_payload,
    generate_eval_cases,
    load_quant_data_price_cache,
    run_ts_runner,
    score_rows,
)


CURRENT_REFERENCE_BUDGET = {
    "meanScore": 76.4591,
    "p10Score": 55.4206,
    "combinedScore": 70.1475,
}

REFERENCE_GUARD_MULTIPLIER = 0.9


@dataclass(frozen=True)
class MechanismCandidate:
    name: str
    profile: dict[str, Any]
    thesis: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run ADM mechanism-level research sweep."
    )
    parser.add_argument(
        "--quant-data-bin", default="quant-data", help="quant-data executable path."
    )
    parser.add_argument(
        "--output-root", default=str(DEFAULT_OUTPUT_ROOT), help="Eval output root."
    )
    parser.add_argument(
        "--sizes", default="5,10,20", help="Comma-separated basket sizes."
    )
    parser.add_argument(
        "--windows", default="1,2,3,5", help="Comma-separated window lengths in years."
    )
    parser.add_argument(
        "--samples-per-size",
        type=int,
        default=5,
        help="Budget samples per size/window pair.",
    )
    parser.add_argument("--seed", type=int, default=20260528, help="Random seed.")
    parser.add_argument("--end-date", default="2026-05-27", help="Backtest end date.")
    parser.add_argument(
        "--run-id",
        default="autoresearch-iter11-60-mechanism-sweep",
        help="Output run id.",
    )
    parser.add_argument(
        "--limit-candidates", type=int, default=50, help="Candidate count to evaluate."
    )
    parser.add_argument(
        "--only-candidate", default=None, help="Run a single candidate by exact name."
    )
    return parser.parse_args()


def combined_score(summary: dict[str, Any]) -> float | None:
    mean = summary.get("meanScore")
    p10 = summary.get("p10Score")
    if not isinstance(mean, (int, float)) or not isinstance(p10, (int, float)):
        return None
    return round(0.7 * float(mean) + 0.3 * float(p10), 4)


def mechanism_candidates(limit: int) -> list[MechanismCandidate]:
    singles = [
        MechanismCandidate(
            "risk-adjusted-rank",
            {"rankMode": "riskAdjusted"},
            "Rank candidates by momentum per realized volatility.",
        ),
        MechanismCandidate(
            "downside-risk-rank",
            {"rankMode": "downsideRiskAdjusted"},
            "Rank candidates by momentum per downside volatility.",
        ),
        MechanismCandidate(
            "drawdown-penalty-rank",
            {"rankMode": "drawdownPenalty"},
            "Penalize candidates with deeper lookback drawdowns.",
        ),
        MechanismCandidate(
            "momentum-slope-rank",
            {"rankMode": "momentumSlope"},
            "Reward candidates whose recent momentum confirms lookback momentum.",
        ),
        MechanismCandidate(
            "positive-futures-bias-rank",
            {"rankMode": "positiveFuturesBias"},
            "Keep futures two-sided but slightly prefer positive trends.",
        ),
        MechanismCandidate(
            "inverse-downside-vol-weight",
            {"riskMode": "inverseDownsideVolatility"},
            "Weight sleeve slots by inverse downside volatility.",
        ),
        MechanismCandidate(
            "sqrt-inverse-vol-weight",
            {"riskMode": "sqrtInverseVolatility"},
            "Soften inverse-vol concentration with square-root weighting.",
        ),
        MechanismCandidate(
            "equal-risk-control",
            {"riskMode": "equalWeight"},
            "Test whether current inverse-vol weighting is overfitting tail cases.",
        ),
        MechanismCandidate(
            "futures-short-confirm",
            {"confirmFuturesShort": True},
            "Route negative futures signals to cash unless recent momentum also confirms.",
        ),
        MechanismCandidate(
            "futures-short-half-weight",
            {"futuresShortWeightMultiplier": 0.5},
            "Cut confirmed futures short exposure in half and hold the remainder as cash.",
        ),
        MechanismCandidate(
            "etf-high-water-filter",
            {"etfHighWaterFilter": True},
            "Require ETF longs to be near their lookback high before taking risk.",
        ),
        MechanismCandidate(
            "recent-shock-cash",
            {"shockToCash": True},
            "Move shocked candidates to cash when recent move dwarfs realized volatility.",
        ),
        MechanismCandidate(
            "close-score-cash",
            {"closeScoreCashFactor": 0.65, "closeScoreThreshold": 0.03},
            "Hold cash when the selected names are too tightly clustered by score.",
        ),
        MechanismCandidate(
            "decay-penalty",
            {"decayPenaltyFactor": 0.7},
            "Reduce weight when recent momentum conflicts with lookback momentum.",
        ),
        MechanismCandidate(
            "max-position-cap",
            {"maxPositionWeight": 0.18},
            "Cap a single selected position and keep the excess in cash.",
        ),
        MechanismCandidate(
            "two-step-rebalance",
            {"rebalanceStep": 0.5},
            "Move only halfway to the new target each rebalance.",
        ),
        MechanismCandidate(
            "small-change-hold-band",
            {"rebalanceWeightHoldBand": 0.03},
            "Ignore small target-weight changes to reduce ranking noise.",
        ),
        MechanismCandidate(
            "larger-cash-buffer",
            {"cashBufferMultiplier": 0.75},
            "Increase the standing cash buffer for extra tail protection.",
        ),
        MechanismCandidate(
            "smaller-cash-buffer",
            {"cashBufferMultiplier": 0.85},
            "Release a little cash to see whether the best mechanism is too defensive.",
        ),
        MechanismCandidate(
            "portfolio-downside-vol-target",
            {"portfolioDownsideVolTarget": True},
            "Scale total exposure down only when the merged signed portfolio has high downside volatility.",
        ),
        MechanismCandidate(
            "cash-risk-free-return",
            {"cashReturnMode": "riskFreeRate"},
            "Accrue base-currency risk-free return on existing ADM cash weight.",
        ),
        MechanismCandidate(
            "netted-residual-cash-return",
            {"nettedResidualCashReturn": True},
            "Accrue cash return on residual fully-funded capital after netted positions.",
        ),
        MechanismCandidate(
            "deduplicate-same-asset-sleeve-budget",
            {"deduplicateSameAssetSleeveBudget": True},
            "Convert duplicate same-direction budget from both ADM sleeves into cash instead of stacking exposure.",
        ),
        MechanismCandidate(
            "risk-exit-redeployment-cooldown",
            {"riskExitRedeploymentCooldown": True},
            "Route exited or flipped risk budget to cash for the current rebalance instead of immediately redeploying it.",
        ),
        MechanismCandidate(
            "cross-sign-offset-cash",
            {"crossSignOffsetCash": True},
            "Compress offsetting long and short gross exposure into cash while keeping the portfolio net direction.",
        ),
        MechanismCandidate(
            "correlated-same-direction-budget-dedup",
            {"correlatedSameDirectionBudgetDedup": True},
            "Compress highly correlated same-direction selected positions into cash instead of treating them as independent risk budgets.",
        ),
        MechanismCandidate(
            "correlated-same-direction-cluster-representative",
            {"correlatedSameDirectionClusterRepresentative": True},
            "Keep only the largest-weight representative inside each highly correlated same-direction cluster and cash out the rest.",
        ),
        MechanismCandidate(
            "risk-trim-redeployment-cooldown",
            {"riskTrimRedeploymentCooldown": True},
            "Route risk budget released by partial same-direction trims to cash instead of immediately redeploying it.",
        ),
    ]
    combo_indexes = [
        (0, 5),
        (0, 8),
        (0, 9),
        (0, 12),
        (0, 13),
        (0, 14),
        (0, 16),
        (0, 17),
        (1, 5),
        (1, 8),
        (1, 9),
        (1, 12),
        (1, 13),
        (1, 14),
        (1, 16),
        (1, 17),
        (2, 5),
        (2, 8),
        (2, 13),
        (2, 14),
        (2, 17),
        (3, 5),
        (3, 8),
        (3, 12),
        (3, 13),
        (3, 16),
        (5, 8),
        (5, 9),
        (5, 12),
        (5, 13),
        (5, 14),
        (5, 16),
        (5, 17),
        (8, 9),
        (8, 12),
        (8, 13),
        (8, 16),
        (9, 13),
        (9, 17),
        (12, 13),
    ]
    candidates = singles[:]
    for left_index, right_index in combo_indexes:
        left = singles[left_index]
        right = singles[right_index]
        profile = {**left.profile, **right.profile}
        candidates.append(
            MechanismCandidate(
                f"{left.name}-plus-{right.name}",
                profile,
                f"Combine: {left.thesis} {right.thesis}",
            )
        )
        if len(candidates) >= limit:
            break
    return candidates[:limit]


def main() -> int:
    args = parse_args()
    context = resolve_eval_config_context(
        sizes=args.sizes,
        windows=args.windows,
        end_date=args.end_date,
    )
    price_cache = load_quant_data_price_cache(
        quant_data_bin=args.quant_data_bin,
        candidates=context.universe,
        start_date=context.required_start,
        end_date=context.end_date,
    )
    candidates_with_prices = [
        candidate for candidate in context.universe if candidate.symbol in price_cache
    ]
    cases = generate_eval_cases(
        candidates=candidates_with_prices,
        basket_sizes=context.basket_sizes,
        windows_years=context.windows_years,
        samples_per_size=args.samples_per_size,
        end_date=context.end_date,
        conflict_groups=context.conflict_groups,
        seed=args.seed,
        limit=None,
    )
    run_dir = create_run_dir(Path(args.output_root), args.run_id)
    rows_dir = run_dir / "candidate-rows"
    rows_dir.mkdir(parents=True, exist_ok=True)
    plan = {
        "dataSource": "quant-data-cli",
        "candidateCount": len(candidates_with_prices),
        "caseCount": len(cases),
        "basketSizes": context.basket_sizes,
        "windowsYears": context.windows_years,
        "samplesPerSize": args.samples_per_size,
        "seed": args.seed,
        "endDate": context.end_date,
        "requiredStartDate": context.required_start,
        "referenceBudget": CURRENT_REFERENCE_BUDGET,
    }
    write_json(run_dir / "cases.json", cases)
    write_json(run_dir / "eval-plan.json", plan)

    results: list[dict[str, Any]] = []
    assets_payload = [
        asset_candidate_to_payload(candidate) for candidate in candidates_with_prices
    ]
    selected_candidates = mechanism_candidates(args.limit_candidates)
    if args.only_candidate:
        selected_candidates = [
            candidate
            for candidate in selected_candidates
            if candidate.name == args.only_candidate
        ]
        if not selected_candidates:
            raise RuntimeError(f"Unknown mechanism candidate: {args.only_candidate}")

    for offset, candidate in enumerate(selected_candidates, start=11):
        candidate_strategy_config = {
            **context.strategy_config,
            "researchProfile": candidate.profile,
        }
        runner_output = run_ts_runner(
            {
                "baseCurrency": context.defaults["baseCurrency"],
                "assets": assets_payload,
                "strategyConfig": candidate_strategy_config,
                "cases": cases,
                "pricesBySymbol": price_cache,
            }
        )
        scored_rows = score_rows(runner_output["rows"], context.defaults["scoring"])
        summary = summarize_scores(scored_rows)
        combined = combined_score(summary)
        decision = (
            "budget-pass"
            if (
                isinstance(summary.get("meanScore"), (int, float))
                and isinstance(summary.get("p10Score"), (int, float))
                and isinstance(combined, float)
                and float(summary["meanScore"])
                >= CURRENT_REFERENCE_BUDGET["meanScore"] * REFERENCE_GUARD_MULTIPLIER
                and float(summary["p10Score"])
                >= CURRENT_REFERENCE_BUDGET["p10Score"] * REFERENCE_GUARD_MULTIPLIER
                and combined > CURRENT_REFERENCE_BUDGET["combinedScore"]
            )
            else "discard"
        )
        result = {
            "iteration": offset,
            "name": candidate.name,
            "thesis": candidate.thesis,
            "profile": candidate.profile,
            "decision": decision,
            "summary": {**summary, "combinedScore": combined},
        }
        results.append(result)
        write_json(rows_dir / f"iter{offset:02d}-{candidate.name}.json", scored_rows)
        print(json.dumps(result, ensure_ascii=False), flush=True)

    write_json(run_dir / "candidate-results.json", results)
    with (run_dir / "candidate-results.tsv").open(
        "w", encoding="utf-8", newline=""
    ) as file:
        writer = csv.DictWriter(
            file,
            fieldnames=[
                "iteration",
                "name",
                "meanScore",
                "p10Score",
                "p50Score",
                "p90Score",
                "combinedScore",
                "decision",
                "thesis",
                "profile",
            ],
            delimiter="\t",
        )
        writer.writeheader()
        for result in results:
            summary = result["summary"]
            writer.writerow(
                {
                    "iteration": result["iteration"],
                    "name": result["name"],
                    "meanScore": summary.get("meanScore"),
                    "p10Score": summary.get("p10Score"),
                    "p50Score": summary.get("p50Score"),
                    "p90Score": summary.get("p90Score"),
                    "combinedScore": summary.get("combinedScore"),
                    "decision": result["decision"],
                    "thesis": result["thesis"],
                    "profile": json.dumps(
                        result["profile"], ensure_ascii=False, sort_keys=True
                    ),
                }
            )
    best = max(
        results,
        key=lambda result: (
            result["summary"].get("combinedScore")
            if isinstance(result["summary"].get("combinedScore"), (int, float))
            else -1
        ),
    )
    print(
        json.dumps(
            {"status": "ok", "runDir": str(run_dir), "best": best},
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
