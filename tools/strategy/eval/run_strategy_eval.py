#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
STRATEGY_DIR = SCRIPT_DIR.parent
REPO_ROOT = SCRIPT_DIR.parents[2]
CONFIG_DIR = SCRIPT_DIR / "config"
DEFAULTS_PATH = CONFIG_DIR / "eval-run-defaults.json"
TS_RUNNER_PATH = SCRIPT_DIR / "generic_eval_runner.ts"
QUANTDESK_DIR = REPO_ROOT / "tools/desktop/quantdesk"

if str(STRATEGY_DIR) not in sys.path:
    sys.path.insert(0, str(STRATEGY_DIR))

from eval_core.cases import (  # noqa: E402
    generate_conflict_group_cases,
    generate_unique_basket_cases,
    start_date_for_window,
    warmup_start_date,
)
from eval_core.contract import (  # noqa: E402
    CANONICAL_STRATEGY_IDS,
    EvalRunRequest,
    StrategyRunSpec,
    eval_run_request_to_payload,
    scoring_profile_from_dict,
)
from eval_core.io import (  # noqa: E402
    create_run_dir,
    join_values,
    load_json,
    parse_csv_list,
    parse_int_list,
    run_ts_runner,
    validate_eval_runtime,
    write_json,
)
from eval_core.prices import load_quant_data_price_cache  # noqa: E402
from eval_core.reporting import write_report, write_tsv  # noqa: E402
from eval_core.scoring import score_rows, summarize_by_strategy  # noqa: E402


def parse_args() -> argparse.Namespace:
    defaults = load_json(DEFAULTS_PATH)
    parser = argparse.ArgumentParser(description="Run Strategy Eval via adapter injection.")
    parser.add_argument("--config", default=None, help="Eval run JSON config path.")
    parser.add_argument("--quant-data-bin", default="quant-data")
    parser.add_argument(
        "--output-root",
        default=str(REPO_ROOT / defaults.get("outputRoot", "thoughts/shared/research/strategy-eval")),
    )
    parser.add_argument("--universe", default=str(CONFIG_DIR / "desktop-current-assets.json"))
    parser.add_argument("--markets", default=join_values(defaults.get("markets", ["A", "BOND"])))
    parser.add_argument("--strategy", action="append", default=None, dest="strategies")
    parser.add_argument("--sizes", default=join_values(defaults["caseGenerator"]["basketSizes"]))
    parser.add_argument("--windows", default=join_values(defaults["caseGenerator"]["windowsYears"]))
    parser.add_argument("--cadences", default=join_values(defaults["caseGenerator"].get("cadences", ["monthly"])))
    parser.add_argument(
        "--samples-per-cell",
        type=int,
        default=int(defaults["caseGenerator"].get("samplesPerCell", 1)),
    )
    parser.add_argument("--seed", type=int, default=int(defaults.get("seed", 20260528)))
    parser.add_argument("--end-date", default=str(defaults.get("endDate")))
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--run-id", default=None)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def load_universe(path: Path, markets: list[str]) -> list[dict[str, Any]]:
    snapshot = load_json(path)
    assets = snapshot.get("assets", [])
    if markets:
        market_set = set(markets)
        assets = [
            asset for asset in assets if asset.get("market") in market_set
        ]
    if not assets:
        raise RuntimeError(f"No assets matched markets: {', '.join(markets) or 'all'}")
    return assets


def resolve_strategy_runs(
    config: dict[str, Any], cli_strategies: list[str] | None
) -> list[StrategyRunSpec]:
    if cli_strategies:
        strategy_ids = cli_strategies
    else:
        strategy_ids = [
            str(item["strategyId"]) for item in config.get("strategyRuns", [])
        ]
    unknown = sorted(set(strategy_ids) - set(CANONICAL_STRATEGY_IDS))
    if unknown:
        raise RuntimeError(
            f"Unsupported strategy ids: {', '.join(unknown)}. "
            f"Available: {', '.join(CANONICAL_STRATEGY_IDS)}"
        )
    defaults_by_id = {
        str(item["strategyId"]): item for item in config.get("strategyRuns", [])
    }
    runs: list[StrategyRunSpec] = []
    for strategy_id in strategy_ids:
        default = defaults_by_id.get(strategy_id, {})
        runs.append(
            StrategyRunSpec(
                strategy_id=strategy_id,
                strategy_mix=dict(default.get("strategyMix") or {}),
                constraints=default.get("constraints"),
                extra_result_fields=tuple(default.get("extraResultFields") or ()),
            )
        )
    return runs


def resolve_required_start(
    *,
    config: dict[str, Any],
    end_date: str,
    strategy_runs: list[StrategyRunSpec],
    windows_years: list[int],
) -> str:
    earliest = start_date_for_window(end_date, max(windows_years))
    for run in strategy_runs:
        if run.strategy_id != "active_dual_momentum_gtaa":
            continue
        adm = run.strategy_mix.get("activeDualMomentum") or config.get("activeDualMomentum") or {}
        long_weeks = int(adm.get("longLookbackWeeks", 25))
        short_weeks = int(adm.get("shortLookbackWeeks", 10))
        warmup_days = (max(long_weeks, short_weeks) + 4) * 7
        earliest = max(earliest, warmup_start_date(earliest, warmup_days))
    return earliest


def generate_cases(
    *,
    assets: list[dict[str, Any]],
    config: dict[str, Any],
    config_base: Path,
    end_date: str,
    limit: int | None,
    samples_per_cell: int,
    seed: int,
    basket_sizes: list[int],
    windows_years: list[int],
    cadences: list[str],
):
    generator = config.get("caseGenerator") or {}
    mode = generator.get("mode", "unique_basket")
    if mode == "conflict_group":
        conflict_path = generator.get("conflictGroupsPath")
        if not conflict_path:
            raise RuntimeError("conflict_group mode requires caseGenerator.conflictGroupsPath")
        resolved = Path(conflict_path)
        if not resolved.is_absolute():
            resolved = (config_base / resolved).resolve()
        conflict_groups = load_json(resolved)
        return generate_conflict_group_cases(
            assets=assets,
            basket_sizes=basket_sizes,
            conflict_groups=conflict_groups,
            end_date=end_date,
            limit=limit,
            samples_per_size=samples_per_cell,
            seed=seed,
            windows_years=windows_years,
        )
    return generate_unique_basket_cases(
        assets=assets,
        basket_sizes=basket_sizes,
        cadences=cadences or [None],
        end_date=end_date,
        limit=limit,
        samples_per_cell=samples_per_cell,
        seed=seed,
        windows_years=windows_years,
    )


def main() -> int:
    args = parse_args()
    config_path = Path(args.config) if args.config else DEFAULTS_PATH
    config = load_json(config_path)
    config_base = config_path.parent
    output_root = Path(args.output_root)
    if args.config and config.get("outputRoot") and "--output-root" not in sys.argv:
        output_root = REPO_ROOT / str(config["outputRoot"])
    markets = parse_csv_list(args.markets)
    basket_sizes = parse_int_list(args.sizes)
    windows_years = parse_int_list(args.windows)
    cadences = parse_csv_list(args.cadences)
    strategy_runs = resolve_strategy_runs(config, args.strategies)
    scoring_profile = scoring_profile_from_dict(config["scoringProfile"])
    default_constraints = dict(config.get("defaultConstraints") or {})
    price_policy = config.get("pricePolicy") or {}
    universe_path = Path(args.universe)
    if not universe_path.is_absolute() and args.config:
        candidate = (config_base / universe_path).resolve()
        if candidate.exists():
            universe_path = candidate
    assets = load_universe(universe_path, markets)
    required_start = resolve_required_start(
        config=config,
        end_date=args.end_date,
        strategy_runs=strategy_runs,
        windows_years=windows_years,
    )

    if args.dry_run:
        prices_by_symbol: dict[str, Any] = {}
        candidates = assets
        coverage_checked = False
        available_price_count = None
    else:
        prices_by_symbol = load_quant_data_price_cache(
            assets=assets,
            bond_market_fallback=bool(price_policy.get("bondMarketFallback", False)),
            end_date=args.end_date,
            min_bars=int(price_policy.get("minBars", 61)),
            quant_data_bin=args.quant_data_bin,
            quantdesk_dir=QUANTDESK_DIR,
            start_date=required_start,
            ts_runner_path=TS_RUNNER_PATH,
        )
        candidates = [asset for asset in assets if asset["symbol"] in prices_by_symbol]
        coverage_checked = True
        available_price_count = len(prices_by_symbol)

    cases = generate_cases(
        assets=candidates,
        basket_sizes=basket_sizes,
        cadences=cadences,
        config=config,
        config_base=config_base,
        end_date=args.end_date,
        limit=args.limit,
        samples_per_cell=args.samples_per_cell,
        seed=args.seed,
        windows_years=windows_years,
    )
    run_dir = create_run_dir(output_root, args.run_id)
    strategies = [run.strategy_id for run in strategy_runs]
    plan = {
        "availablePriceCount": available_price_count,
        "baseCurrency": config.get("baseCurrency", "CNY"),
        "basketSizes": basket_sizes,
        "cadences": cadences,
        "candidateCount": len(candidates),
        "caseCount": len(cases) * len(strategy_runs),
        "coverageChecked": coverage_checked,
        "dataSource": "quant-data-cli",
        "dryRun": args.dry_run,
        "endDate": args.end_date,
        "markets": markets,
        "quantDataBin": args.quant_data_bin,
        "requiredStartDate": required_start,
        "samplesPerCell": args.samples_per_cell,
        "scoringProfile": config["scoringProfile"],
        "seed": args.seed,
        "strategies": strategies,
        "tsRunner": str(TS_RUNNER_PATH),
        "universe": str(Path(args.universe)),
        "universeCount": len(assets),
        "windowsYears": windows_years,
    }
    write_json(
        run_dir / "cases.json",
        [
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
            for case in cases
        ],
    )
    write_json(run_dir / "eval-plan.json", plan)

    if args.dry_run:
        validate_eval_runtime(args.quant_data_bin, TS_RUNNER_PATH, QUANTDESK_DIR)
        print(json.dumps({"status": "dry-run", "runDir": str(run_dir), **plan}, ensure_ascii=False, indent=2))
        return 0

    request = EvalRunRequest(
        base_currency=str(config.get("baseCurrency", "CNY")),
        assets=candidates,
        cases=cases,
        default_constraints=default_constraints,
        prices_by_symbol=prices_by_symbol,
        run_id=args.run_id,
        strategy_runs=strategy_runs,
    )
    runner_output = run_ts_runner(
        eval_run_request_to_payload(request),
        quantdesk_dir=QUANTDESK_DIR,
        ts_runner_path=TS_RUNNER_PATH,
    )
    extra_fields = sorted(
        {
            field
            for run in strategy_runs
            for field in run.extra_result_fields
        }
    )
    rows = score_rows(runner_output["rows"], scoring_profile)
    summary = summarize_by_strategy(rows, scoring_profile)
    write_json(run_dir / "results.json", rows)
    write_json(run_dir / "score-summary.json", summary)
    write_tsv(run_dir / "results.tsv", rows, extra_fields=extra_fields)
    write_report(run_dir / "report.md", summary, plan, profile=scoring_profile)
    print(
        json.dumps(
            {"status": "ok", "runDir": str(run_dir), "summary": summary},
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
