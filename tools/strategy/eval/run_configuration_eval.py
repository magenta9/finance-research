#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import random
import shutil
import subprocess
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[2]
CONFIG_DIR = SCRIPT_DIR / "config"
DEFAULTS_PATH = CONFIG_DIR / "configuration-eval-defaults.json"
UNIVERSE_SNAPSHOT_PATH = CONFIG_DIR / "desktop-current-assets.json"
TS_RUNNER_PATH = SCRIPT_DIR / "configuration_eval_runner.ts"
QUANTDESK_DIR = REPO_ROOT / "tools/desktop/quantdesk"
DEFAULT_OUTPUT_ROOT = REPO_ROOT / "thoughts/shared/research/configuration-strategy-eval"


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)
        file.write("\n")


def parse_csv_list(value: str) -> list[str]:
    parsed = [item.strip() for item in value.split(",") if item.strip()]
    if not parsed:
        raise ValueError("Expected at least one value.")
    return parsed


def parse_int_list(value: str) -> list[int]:
    return [int(item) for item in parse_csv_list(value)]


def join_values(values: list[Any]) -> str:
    return ",".join(str(value) for value in values)


def start_date_for_window(end_date: str, years: int) -> str:
    end = date.fromisoformat(end_date)
    return (end - timedelta(days=365 * years)).isoformat()


def clamp(value: float, lower: float = 0.0, upper: float = 1.0) -> float:
    return min(upper, max(lower, value))


def score_result(metrics: dict[str, Any], scoring: dict[str, Any]) -> float:
    sharpe = float(metrics.get("sharpeRatio", metrics.get("sharpe", 0)) or 0)
    max_drawdown = abs(float(metrics.get("maxDrawdown", 0) or 0))
    volatility = float(metrics.get("volatility", 0) or 0)
    sharpe_component = clamp(
        (sharpe - float(scoring["sharpeFloor"]))
        / (float(scoring["sharpeCeiling"]) - float(scoring["sharpeFloor"]))
    )
    drawdown_component = clamp(1 - max_drawdown / float(scoring["maxDrawdownCeiling"]))
    volatility_component = clamp(1 - volatility / float(scoring["volatilityCeiling"]))
    score = 100 * (
        float(scoring["sharpeWeight"]) * sharpe_component
        + float(scoring["maxDrawdownWeight"]) * drawdown_component
        + float(scoring["volatilityWeight"]) * volatility_component
    )
    return round(score, 4)


def percentile(sorted_values: list[float], ratio: float) -> float | None:
    if not sorted_values:
        return None
    index = min(
        len(sorted_values) - 1, max(0, math.floor((len(sorted_values) - 1) * ratio))
    )
    return round(sorted_values[index], 4)


def final_score(summary: dict[str, Any]) -> float | None:
    p10 = summary.get("p10Score")
    p50 = summary.get("p50Score")
    p90 = summary.get("p90Score")
    if not all(isinstance(value, (int, float)) for value in [p10, p50, p90]):
        return None
    return round(0.25 * float(p10) + 0.5 * float(p50) + 0.25 * float(p90), 4)


def summarize_scores(rows: list[dict[str, Any]]) -> dict[str, Any]:
    successful = [
        row
        for row in rows
        if row.get("status") == "ok" and isinstance(row.get("score"), (int, float))
    ]
    failed = [row for row in rows if row.get("status") != "ok"]
    scores = sorted(float(row["score"]) for row in successful)
    summary = {
        "caseCount": len(rows),
        "successCount": len(successful),
        "failureCount": len(failed),
        "meanScore": round(sum(scores) / len(scores), 4) if scores else None,
        "p10Score": percentile(scores, 0.1),
        "p50Score": percentile(scores, 0.5),
        "p90Score": percentile(scores, 0.9),
    }
    return {**summary, "finalScore": final_score(summary)}


def create_run_dir(output_root: Path, run_id: str | None = None) -> Path:
    today = datetime.now().strftime("%Y-%m-%d")
    resolved_run_id = run_id or datetime.now().strftime("%H%M%S")
    run_dir = output_root / today / resolved_run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    return run_dir


def parse_args() -> argparse.Namespace:
    defaults = load_json(DEFAULTS_PATH)
    parser = argparse.ArgumentParser(
        description="Run Configuration Strategy eval cases."
    )
    parser.add_argument("--quant-data-bin", default="quant-data")
    parser.add_argument("--output-root", default=str(DEFAULT_OUTPUT_ROOT))
    parser.add_argument("--universe", default=str(UNIVERSE_SNAPSHOT_PATH))
    parser.add_argument("--markets", default=join_values(defaults["markets"]))
    parser.add_argument("--strategies", default=join_values(defaults["strategies"]))
    parser.add_argument("--sizes", default=join_values(defaults["basketSizes"]))
    parser.add_argument("--windows", default=join_values(defaults["windowsYears"]))
    parser.add_argument("--cadences", default=join_values(defaults["cadences"]))
    parser.add_argument(
        "--samples-per-cell", type=int, default=int(defaults["samplesPerCell"])
    )
    parser.add_argument("--seed", type=int, default=int(defaults["seed"]))
    parser.add_argument("--end-date", default=str(defaults["endDate"]))
    parser.add_argument("--strategy-config", default=None)
    parser.add_argument("--strategy-config-json", default=None)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--run-id", default=None)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def load_universe(path: Path, markets: list[str]) -> list[dict[str, Any]]:
    snapshot = load_json(path)
    market_set = set(markets)
    assets = [
        asset
        for asset in snapshot.get("assets", [])
        if asset.get("market") in market_set
    ]
    if not assets:
        raise RuntimeError(f"No assets matched markets: {', '.join(markets)}")
    return assets


def case_id(symbols: list[str], years: int, cadence: str, sample_index: int) -> str:
    payload = json.dumps(
        {
            "cadence": cadence,
            "sampleIndex": sample_index,
            "symbols": symbols,
            "years": years,
        },
        sort_keys=True,
    )
    digest = hashlib.sha1(payload.encode("utf-8")).hexdigest()[:12]
    return f"cfg-{cadence}-{years}y-{sample_index:03d}-{digest}"


def draw_unique_symbols(
    *,
    basket_size: int,
    rng: random.Random,
    seen: set[tuple[str, ...]],
    symbols: list[str],
    max_attempts: int = 5000,
) -> list[str]:
    if basket_size > len(symbols):
        raise RuntimeError(
            f"Basket size {basket_size} exceeds candidate count {len(symbols)}."
        )
    for _ in range(max_attempts):
        selected = tuple(sorted(rng.sample(symbols, basket_size)))
        if selected not in seen:
            seen.add(selected)
            return list(selected)
    raise RuntimeError(
        f"Could not draw a unique {basket_size}-asset basket after {max_attempts} attempts."
    )


def generate_eval_cases(
    *,
    assets: list[dict[str, Any]],
    basket_sizes: list[int],
    cadences: list[str],
    end_date: str,
    limit: int | None,
    samples_per_cell: int,
    seed: int,
    windows_years: list[int],
) -> list[dict[str, Any]]:
    symbols = sorted({str(asset["symbol"]) for asset in assets})
    cases: list[dict[str, Any]] = []
    rng = random.Random(seed)
    for cadence in cadences:
        for years in windows_years:
            start_date = start_date_for_window(end_date, years)
            for basket_size in basket_sizes:
                seen: set[tuple[str, ...]] = set()
                for sample_index in range(samples_per_cell):
                    selected_symbols = draw_unique_symbols(
                        basket_size=basket_size,
                        rng=rng,
                        seen=seen,
                        symbols=symbols,
                    )
                    cases.append(
                        {
                            "basketSize": basket_size,
                            "caseId": case_id(
                                selected_symbols, years, cadence, sample_index
                            ),
                            "endDate": end_date,
                            "rebalanceCadence": cadence,
                            "sampleIndex": sample_index,
                            "startDate": start_date,
                            "symbols": selected_symbols,
                            "windowYears": years,
                        }
                    )
                    if limit is not None and len(cases) >= limit:
                        return cases
    return cases


def validate_dry_run(quant_data_bin: str) -> None:
    if shutil.which(quant_data_bin) is None:
        raise RuntimeError(f"quant-data executable not found: {quant_data_bin}")
    if not TS_RUNNER_PATH.exists():
        raise FileNotFoundError(f"TS runner not found: {TS_RUNNER_PATH}")
    if shutil.which("pnpm") is None:
        raise RuntimeError("pnpm is required to run the TypeScript backtest runner.")
    help_envelope = call_quant_data(quant_data_bin, "help", {}, json_flag=True)
    methods = {method.get("name") for method in help_envelope.get("methods", [])}
    if "get-price-series" not in methods:
        raise RuntimeError("quant-data is missing required method: get-price-series")


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


def load_quant_data_price_cache(
    *,
    assets: list[dict[str, Any]],
    end_date: str,
    quant_data_bin: str,
    start_date: str,
) -> dict[str, Any]:
    validate_dry_run(quant_data_bin)
    prices_by_symbol: dict[str, Any] = {}
    for index, asset in enumerate(assets, start=1):
        symbol = str(asset["symbol"])
        sys.stderr.write(f"fetching price series {index}/{len(assets)} {symbol}\n")
        envelope, request_market = fetch_price_series_with_market_fallback(
            asset=asset,
            end_date=end_date,
            quant_data_bin=quant_data_bin,
            start_date=start_date,
        )
        if envelope is None or not envelope.get("ok"):
            continue
        data = envelope.get("data") or {}
        prices = data.get("prices") or []
        if len(prices) >= 61:
            prices_by_symbol[symbol] = {
                "providerSymbol": data.get("symbol") or symbol,
                "prices": prices,
                "requestMarket": request_market,
                "warnings": data.get("warnings") or [],
                "provenance": envelope.get("resultProvenance") or {},
            }
    return prices_by_symbol


def fetch_price_series_with_market_fallback(
    *,
    asset: dict[str, Any],
    end_date: str,
    quant_data_bin: str,
    start_date: str,
) -> tuple[dict[str, Any] | None, str | None]:
    symbol = str(asset["symbol"])
    original_market = str(asset.get("market") or "")
    markets = [original_market]
    if original_market == "BOND":
        markets.extend(["A", "FUND"])

    for market in markets:
        envelope = call_quant_data(
            quant_data_bin,
            "get-price-series",
            {
                "assetId": asset.get("id"),
                "symbol": symbol,
                "market": market,
                "start": start_date,
                "end": end_date,
            },
        )
        data = envelope.get("data") or {}
        prices = data.get("prices") or []
        if envelope.get("ok") and len(prices) >= 61:
            return envelope, market

    return None, None


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
            f"Configuration eval runner failed with exit code {process.returncode}."
        )
    if process.stderr.strip():
        sys.stderr.write(process.stderr)
    return json.loads(process.stdout)


def load_strategy_config(path: str | None, inline_json: str | None) -> dict[str, Any]:
    if inline_json:
        return json.loads(inline_json)
    if path is None:
        return {}
    return load_json(Path(path))


def score_rows(
    rows: list[dict[str, Any]], scoring: dict[str, Any]
) -> list[dict[str, Any]]:
    scored = []
    for row in rows:
        if row.get("status") == "ok":
            row = {**row, "score": score_result(row["metrics"], scoring)}
        scored.append(row)
    return scored


def summarize_by_strategy(rows: list[dict[str, Any]]) -> dict[str, Any]:
    strategy_ids = sorted({str(row.get("strategyId")) for row in rows})
    by_strategy = {
        strategy_id: summarize_scores(
            [row for row in rows if row.get("strategyId") == strategy_id]
        )
        for strategy_id in strategy_ids
    }
    leaderboard = sorted(
        [
            {"strategyId": strategy_id, **summary}
            for strategy_id, summary in by_strategy.items()
        ],
        key=lambda row: (
            row["finalScore"] if isinstance(row.get("finalScore"), (int, float)) else -1
        ),
        reverse=True,
    )
    return {
        "overall": summarize_scores(rows),
        "byStrategy": by_strategy,
        "leaderboard": leaderboard,
    }


def write_tsv(path: Path, rows: list[dict[str, Any]]) -> None:
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
            error = row.get("error")
            writer.writerow(
                {
                    **row,
                    "error": error if error else "-",
                    "expectedReturn": metrics.get("expectedReturn"),
                    "maxDrawdown": metrics.get("maxDrawdown"),
                    "sharpeRatio": metrics.get("sharpeRatio"),
                    "symbols": ",".join(row.get("symbols") or []),
                    "volatility": metrics.get("volatility"),
                }
            )


def write_report(path: Path, summary: dict[str, Any], plan: dict[str, Any]) -> None:
    lines = [
        "# Configuration Strategy Eval",
        "",
        f"- Data source: {plan['dataSource']}",
        f"- Universe: {', '.join(plan['markets'])} ({plan['candidateCount']} candidates)",
        f"- Strategies: {', '.join(plan['strategies'])}",
        f"- Basket sizes: {', '.join(str(value) for value in plan['basketSizes'])}",
        f"- Windows: {', '.join(str(value) for value in plan['windowsYears'])} years",
        f"- Cadences: {', '.join(plan['cadences'])}",
        f"- Samples per cell: {plan['samplesPerCell']}",
        f"- Base cases: {plan['baseCaseCount']}",
        f"- Strategy cases: {plan['caseCount']}",
        f"- End date: {plan['endDate']}",
        f"- Seed: {plan['seed']}",
        "",
        "## Leaderboard",
        "",
        "| Strategy | Final | P10 | P50 | P90 | Mean | Success | Failure |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for row in summary["leaderboard"]:
        lines.append(
            f"| {row['strategyId']} | {row['finalScore']} | {row['p10Score']} | {row['p50Score']} | {row['p90Score']} | {row['meanScore']} | {row['successCount']} | {row['failureCount']} |"
        )
    lines.extend(
        [
            "",
            "Final score formula: `0.5 * p50Score + 0.25 * p10Score + 0.25 * p90Score`.",
            "Single-case score formula: Sharpe 50%, max drawdown 30%, volatility 20%.",
        ]
    )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    defaults = load_json(DEFAULTS_PATH)
    args = parse_args()
    markets = parse_csv_list(args.markets)
    strategies = parse_csv_list(args.strategies)
    basket_sizes = parse_int_list(args.sizes)
    windows_years = parse_int_list(args.windows)
    cadences = parse_csv_list(args.cadences)
    strategy_config = load_strategy_config(
        args.strategy_config, args.strategy_config_json
    )
    assets = load_universe(Path(args.universe), markets)
    required_start = start_date_for_window(args.end_date, max(windows_years))

    if args.dry_run:
        prices_by_symbol: dict[str, Any] = {}
        candidates = assets
        coverage_checked = False
        available_price_count = None
    else:
        prices_by_symbol = load_quant_data_price_cache(
            assets=assets,
            end_date=args.end_date,
            quant_data_bin=args.quant_data_bin,
            start_date=required_start,
        )
        candidates = [asset for asset in assets if asset["symbol"] in prices_by_symbol]
        coverage_checked = True
        available_price_count = len(prices_by_symbol)

    cases = generate_eval_cases(
        assets=candidates,
        basket_sizes=basket_sizes,
        cadences=cadences,
        end_date=args.end_date,
        limit=args.limit,
        samples_per_cell=args.samples_per_cell,
        seed=args.seed,
        windows_years=windows_years,
    )
    run_dir = create_run_dir(Path(args.output_root), args.run_id)
    plan = {
        "availablePriceCount": available_price_count,
        "baseCaseCount": len(cases),
        "baseCurrency": defaults["baseCurrency"],
        "basketSizes": basket_sizes,
        "cadences": cadences,
        "candidateCount": len(candidates),
        "caseCount": len(cases) * len(strategies),
        "constraints": defaults["constraints"],
        "coverageChecked": coverage_checked,
        "dataSource": "quant-data-cli",
        "dryRun": args.dry_run,
        "endDate": args.end_date,
        "markets": markets,
        "quantDataBin": args.quant_data_bin,
        "requiredStartDate": required_start,
        "samplesPerCell": args.samples_per_cell,
        "seed": args.seed,
        "strategyConfig": strategy_config,
        "strategyConfigPath": args.strategy_config,
        "strategies": strategies,
        "tsRunner": str(TS_RUNNER_PATH),
        "universe": str(Path(args.universe)),
        "universeCount": len(assets),
        "windowsYears": windows_years,
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
            "assets": candidates,
            "baseCurrency": defaults["baseCurrency"],
            "cases": cases,
            "constraints": defaults["constraints"],
            "pricesBySymbol": prices_by_symbol,
            "strategyConfigs": strategy_config,
            "strategies": strategies,
        }
    )
    rows = score_rows(runner_output["rows"], defaults["scoring"])
    summary = summarize_by_strategy(rows)
    write_json(run_dir / "configuration-results.json", rows)
    write_json(run_dir / "score-summary.json", summary)
    write_tsv(run_dir / "configuration-results.tsv", rows)
    write_report(run_dir / "report.md", summary, plan)
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
