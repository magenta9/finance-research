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
    load_asset_candidates,
    load_json,
    parse_int_list,
    resolve_end_date,
    start_date_for_window,
    summarize_scores,
    warmup_start_date,
    write_json,
)
from run_eval import (
    CONFLICT_GROUPS_PATH,
    DEFAULTS_PATH,
    UNIVERSE_PATH,
    asset_candidate_to_payload,
    generate_eval_cases,
    load_quant_data_price_cache,
    run_ts_runner,
    score_rows,
)


REFERENCE_BUDGET_BEFORE_ITER11 = {
    "meanScore": 71.4550,
    "p10Score": 43.6283,
    "combinedScore": 63.1070,
}


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
    defaults = load_json(DEFAULTS_PATH)
    conflict_groups = load_json(CONFLICT_GROUPS_PATH)
    basket_sizes = parse_int_list(args.sizes)
    windows_years = parse_int_list(args.windows)
    end_date = resolve_end_date(args.end_date)
    strategy_config = defaults["strategyConfig"]
    warmup_days = (
        max(
            int(strategy_config["longLookbackWeeks"]),
            int(strategy_config["shortLookbackWeeks"]),
        )
        + 4
    ) * 7
    earliest_start = start_date_for_window(end_date, max(windows_years))
    required_start = warmup_start_date(earliest_start, warmup_days)
    universe = load_asset_candidates(UNIVERSE_PATH)
    price_cache = load_quant_data_price_cache(
        quant_data_bin=args.quant_data_bin,
        candidates=universe,
        start_date=required_start,
        end_date=end_date,
    )
    candidates_with_prices = [
        candidate for candidate in universe if candidate.symbol in price_cache
    ]
    cases = generate_eval_cases(
        candidates=candidates_with_prices,
        basket_sizes=basket_sizes,
        windows_years=windows_years,
        samples_per_size=args.samples_per_size,
        end_date=end_date,
        conflict_groups=conflict_groups,
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
        "basketSizes": basket_sizes,
        "windowsYears": windows_years,
        "samplesPerSize": args.samples_per_size,
        "seed": args.seed,
        "endDate": end_date,
        "requiredStartDate": required_start,
        "referenceBudgetBeforeIter11": REFERENCE_BUDGET_BEFORE_ITER11,
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
            **strategy_config,
            "researchProfile": candidate.profile,
        }
        runner_output = run_ts_runner(
            {
                "baseCurrency": defaults["baseCurrency"],
                "assets": assets_payload,
                "strategyConfig": candidate_strategy_config,
                "cases": cases,
                "pricesBySymbol": price_cache,
            }
        )
        scored_rows = score_rows(runner_output["rows"], defaults["scoring"])
        summary = summarize_scores(scored_rows)
        combined = combined_score(summary)
        decision = (
            "budget-pass"
            if (
                isinstance(summary.get("meanScore"), (int, float))
                and isinstance(summary.get("p10Score"), (int, float))
                and isinstance(combined, float)
                and float(summary["meanScore"])
                >= REFERENCE_BUDGET_BEFORE_ITER11["meanScore"]
                and float(summary["p10Score"])
                >= REFERENCE_BUDGET_BEFORE_ITER11["p10Score"]
                and combined > REFERENCE_BUDGET_BEFORE_ITER11["combinedScore"]
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
