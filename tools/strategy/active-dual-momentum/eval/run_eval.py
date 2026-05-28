#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

from eval_lib import (
    DEFAULT_OUTPUT_ROOT,
    REPO_ROOT,
    create_run_dir,
    generate_cases,
    load_asset_candidates,
    load_json,
    parse_int_list,
    resolve_end_date,
    score_result,
    start_date_for_window,
    summarize_scores,
    warmup_start_date,
    write_json,
)


SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULTS_PATH = SCRIPT_DIR / "config/eval-defaults.json"
CONFLICT_GROUPS_PATH = SCRIPT_DIR / "config/conflict-groups.json"
UNIVERSE_PATH = SCRIPT_DIR / "config/universe.json"
TS_RUNNER_PATH = SCRIPT_DIR / "adm_eval_runner.ts"
QUANTDESK_DIR = REPO_ROOT / "tools/desktop/quantdesk"


def parse_args() -> argparse.Namespace:
    defaults = load_json(DEFAULTS_PATH)
    parser = argparse.ArgumentParser(description="Run Active Dual Momentum eval cases.")
    parser.add_argument(
        "--quant-data-bin",
        default="quant-data",
        help="quant-data executable path.",
    )
    parser.add_argument(
        "--output-root", default=str(DEFAULT_OUTPUT_ROOT), help="Eval output root."
    )
    parser.add_argument(
        "--sizes",
        default=join_ints(defaults["basketSizes"]),
        help="Comma-separated basket sizes.",
    )
    parser.add_argument(
        "--windows",
        default=join_ints(defaults["windowsYears"]),
        help="Comma-separated window lengths in years.",
    )
    parser.add_argument(
        "--samples-per-size",
        type=int,
        default=int(defaults["samplesPerSize"]),
        help="Samples per size/window pair.",
    )
    parser.add_argument(
        "--seed", type=int, default=int(defaults["seed"]), help="Random seed."
    )
    parser.add_argument(
        "--end-date",
        default="2026-05-27",
        help="Backtest end date. Defaults to the latest known quant-data date for this eval.",
    )
    parser.add_argument(
        "--limit", type=int, default=None, help="Limit total generated cases."
    )
    parser.add_argument("--run-id", default=None, help="Optional output run id.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate inputs and write a plan without running backtests.",
    )
    return parser.parse_args()


def join_ints(values: list[int]) -> str:
    return ",".join(str(value) for value in values)


def main() -> int:
    args = parse_args()
    output_root = Path(args.output_root)
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

    if args.dry_run:
        price_cache: dict[str, Any] = {}
        candidates = universe
        coverage_checked = False
        available_price_count = None
    else:
        price_cache = load_quant_data_price_cache(
            quant_data_bin=args.quant_data_bin,
            candidates=universe,
            start_date=required_start,
            end_date=end_date,
        )
        candidates = [
            candidate for candidate in universe if candidate.symbol in price_cache
        ]
        coverage_checked = True
        available_price_count = len(price_cache)

    cases = generate_eval_cases(
        candidates=candidates,
        basket_sizes=basket_sizes,
        windows_years=windows_years,
        samples_per_size=args.samples_per_size,
        end_date=end_date,
        conflict_groups=conflict_groups,
        seed=args.seed,
        limit=args.limit,
    )
    run_dir = create_run_dir(output_root, args.run_id)
    plan = {
        "dataSource": "quant-data-cli",
        "quantDataBin": args.quant_data_bin,
        "universeCount": len(universe),
        "coverageChecked": coverage_checked,
        "availablePriceCount": available_price_count,
        "candidateCount": len(candidates),
        "caseCount": len(cases),
        "basketSizes": basket_sizes,
        "windowsYears": windows_years,
        "samplesPerSize": args.samples_per_size,
        "seed": args.seed,
        "endDate": end_date,
        "requiredStartDate": required_start,
        "strategyConfig": strategy_config,
        "dryRun": args.dry_run,
        "tsRunner": str(TS_RUNNER_PATH),
    }
    write_json(run_dir / "cases.json", cases)
    write_json(run_dir / "eval-plan.json", plan)

    if args.dry_run:
        validate_dry_run(args.quant_data_bin)
        print(
            json.dumps(
                {"status": "dry-run", "runDir": str(run_dir), **plan},
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0

    runner_output = run_ts_runner(
        {
            "baseCurrency": defaults["baseCurrency"],
            "assets": [
                asset_candidate_to_payload(candidate) for candidate in candidates
            ],
            "strategyConfig": strategy_config,
            "cases": cases,
            "pricesBySymbol": price_cache,
        }
    )
    rows = score_rows(runner_output["rows"], defaults["scoring"])
    summary = summarize_scores(rows)
    write_json(run_dir / "baseline-results.json", rows)
    write_json(run_dir / "score-summary.json", summary)
    write_tsv(run_dir / "baseline-results.tsv", rows)
    write_report(run_dir / "report.md", summary, plan)
    print(
        json.dumps(
            {"status": "ok", "runDir": str(run_dir), "summary": summary},
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


def validate_dry_run(quant_data_bin: str) -> None:
    if shutil.which(quant_data_bin) is None:
        raise RuntimeError(f"quant-data executable not found: {quant_data_bin}")
    if not TS_RUNNER_PATH.exists():
        raise FileNotFoundError(f"TS runner not found: {TS_RUNNER_PATH}")
    if shutil.which("pnpm") is None:
        raise RuntimeError("pnpm is required to run the TypeScript backtest runner.")
    help_envelope = call_quant_data(quant_data_bin, "help", {}, json_flag=True)
    methods = {method.get("name") for method in help_envelope.get("methods", [])}
    required = {"get-price-series"}
    missing = sorted(required - methods)
    if missing:
        raise RuntimeError(
            f"quant-data is missing required methods: {', '.join(missing)}"
        )


def generate_eval_cases(
    *,
    candidates: list[Any],
    basket_sizes: list[int],
    windows_years: list[int],
    samples_per_size: int,
    end_date: str,
    conflict_groups: dict[str, list[str]],
    seed: int,
    limit: int | None,
) -> list[dict[str, Any]]:
    cases: list[dict[str, Any]] = []
    for years in windows_years:
        for basket_size in basket_sizes:
            try:
                generated = generate_cases(
                    candidates=candidates,
                    basket_sizes=[basket_size],
                    windows_years=[years],
                    samples_per_size=samples_per_size,
                    end_date=end_date,
                    conflict_groups=conflict_groups,
                    seed=seed + years * 1000 + basket_size,
                    limit=None,
                )
                cases.extend(generated)
            except RuntimeError as error:
                for sample_index in range(samples_per_size):
                    cases.append(
                        {
                            "caseId": f"adm-{years}y-{sample_index:03d}-skipped-{basket_size}",
                            "windowYears": years,
                            "basketSize": basket_size,
                            "sampleIndex": sample_index,
                            "startDate": start_date_for_window(end_date, years),
                            "endDate": end_date,
                            "assetIds": [],
                            "symbols": [],
                            "skipReason": str(error),
                        }
                    )
            if limit is not None and len(cases) >= limit:
                return cases[:limit]
    return cases


def asset_candidate_to_payload(candidate: Any) -> dict[str, Any]:
    return {
        "id": candidate.id,
        "symbol": candidate.symbol,
        "name": candidate.name,
        "market": candidate.market,
        "assetClass": candidate.asset_class,
        "currency": candidate.currency,
        "tags": list(candidate.tags),
        "metadata": candidate.metadata or {},
    }


def load_quant_data_price_cache(
    *,
    quant_data_bin: str,
    candidates: list[Any],
    start_date: str,
    end_date: str,
) -> dict[str, Any]:
    validate_dry_run(quant_data_bin)
    prices_by_symbol: dict[str, Any] = {}
    for index, candidate in enumerate(candidates, start=1):
        sys.stderr.write(f"fetching price series {index}/{len(candidates)} {candidate.symbol}\n")
        envelope = call_quant_data(
            quant_data_bin,
            "get-price-series",
            {
                "symbol": candidate.symbol,
                "market": candidate.market,
                "start": start_date,
                "end": end_date,
            },
        )
        if not envelope.get("ok"):
            continue
        data = envelope.get("data") or {}
        prices = data.get("prices") or []
        if len(prices) >= 61:
            prices_by_symbol[candidate.symbol] = {
                "providerSymbol": data.get("symbol") or candidate.symbol,
                "prices": prices,
                "warnings": data.get("warnings") or [],
                "provenance": envelope.get("resultProvenance") or {},
            }
    return prices_by_symbol


def call_quant_data(
    quant_data_bin: str,
    method: str,
    payload: dict[str, Any],
    *,
    json_flag: bool = False,
) -> dict[str, Any]:
    command = [quant_data_bin, method]
    if json_flag:
        command.append("--json")
    process = subprocess.run(
        command,
        input=json.dumps(payload, ensure_ascii=False) if payload else None,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if process.returncode != 0:
        sys.stderr.write(process.stderr)
        raise RuntimeError(
            f"quant-data {method} failed with exit code {process.returncode}."
        )
    if process.stderr.strip():
        sys.stderr.write(process.stderr)
    return json.loads(process.stdout)


def run_ts_runner(payload: dict[str, Any]) -> dict[str, Any]:
    process = subprocess.run(
        ["pnpm", "--dir", str(QUANTDESK_DIR), "exec", "tsx", str(TS_RUNNER_PATH)],
        input=json.dumps(payload, ensure_ascii=False),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if process.returncode != 0:
        sys.stderr.write(process.stderr)
        raise RuntimeError(
            f"ADM eval runner failed with exit code {process.returncode}."
        )
    if process.stderr.strip():
        sys.stderr.write(process.stderr)
    return json.loads(process.stdout)


def score_rows(
    rows: list[dict[str, Any]], scoring: dict[str, Any]
) -> list[dict[str, Any]]:
    scored = []
    for row in rows:
        if row.get("status") == "ok":
            row = {**row, "score": score_result(row["metrics"], scoring)}
        scored.append(row)
    return scored


def write_tsv(path: Path, rows: list[dict[str, Any]]) -> None:
    fields = [
        "caseId",
        "status",
        "basketSize",
        "windowYears",
        "startDate",
        "endDate",
        "symbols",
        "strategyId",
        "score",
        "expectedReturn",
        "volatility",
        "sharpeRatio",
        "maxDrawdown",
        "calmarRatio",
        "winRate",
        "error",
    ]
    with path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(
            file, fieldnames=fields, delimiter="\t", extrasaction="ignore"
        )
        writer.writeheader()
        for row in rows:
            metrics = row.get("metrics") or {}
            writer.writerow(
                {
                    **row,
                    "symbols": ",".join(row.get("symbols") or []),
                    "expectedReturn": metrics.get("expectedReturn"),
                    "volatility": metrics.get("volatility"),
                    "sharpeRatio": metrics.get("sharpeRatio"),
                    "maxDrawdown": metrics.get("maxDrawdown"),
                    "calmarRatio": row.get("calmarRatio"),
                    "winRate": row.get("winRate"),
                }
            )


def write_report(path: Path, summary: dict[str, Any], plan: dict[str, Any]) -> None:
    lines = [
        "# Active Dual Momentum Eval Baseline",
        "",
        f"- Cases: {summary['caseCount']}",
        f"- Success: {summary['successCount']}",
        f"- Failure: {summary['failureCount']}",
        f"- Mean score: {summary['meanScore']}",
        f"- P10/P50/P90: {summary['p10Score']} / {summary['p50Score']} / {summary['p90Score']}",
        f"- Candidate assets: {plan['candidateCount']}",
        f"- End date: {plan['endDate']}",
        f"- Seed: {plan['seed']}",
        "",
        "Data provenance: quant-data CLI get-price-series output.",
    ]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
