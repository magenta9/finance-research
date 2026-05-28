from __future__ import annotations

import hashlib
import json
import math
import random
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_OUTPUT_ROOT = REPO_ROOT / "thoughts/shared/research/active-dual-momentum-eval"


@dataclass(frozen=True)
class AssetCandidate:
    id: str
    symbol: str
    name: str
    market: str
    asset_class: str
    currency: str = "CNY"
    tags: tuple[str, ...] = ()
    metadata: dict[str, Any] | None = None


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def parse_int_list(value: str) -> list[int]:
    parsed = [int(item.strip()) for item in value.split(",") if item.strip()]
    if not parsed:
        raise ValueError("Expected at least one integer.")
    return parsed


def resolve_end_date(requested: str | None) -> str:
    if requested:
        return requested
    return date.today().isoformat()


def start_date_for_window(end_date: str, years: int) -> str:
    end = date.fromisoformat(end_date)
    return (end - timedelta(days=365 * years)).isoformat()


def warmup_start_date(start_date: str, warmup_days: int) -> str:
    return (date.fromisoformat(start_date) - timedelta(days=warmup_days)).isoformat()


def load_asset_candidates(path: Path) -> list[AssetCandidate]:
    payload = load_json(path)
    assets = payload.get("assets", [])
    return [
        AssetCandidate(
            id=str(row.get("id") or row["symbol"]),
            symbol=row["symbol"],
            name=row.get("name") or row["symbol"],
            market=row.get("market") or "A",
            asset_class=row.get("assetClass") or row.get("asset_class") or "equity",
            currency=row.get("currency") or "CNY",
            tags=tuple(row.get("tags") or []),
            metadata=row.get("metadata") or {},
        )
        for row in assets
    ]


def conflict_violations(
    symbols: list[str], conflict_groups: dict[str, list[str]]
) -> list[str]:
    symbol_set = set(symbols)
    violations: list[str] = []
    for name, group in conflict_groups.items():
        if len(symbol_set.intersection(group)) > 1:
            violations.append(name)
    return violations


def generate_cases(
    *,
    candidates: list[AssetCandidate],
    basket_sizes: list[int],
    windows_years: list[int],
    samples_per_size: int,
    end_date: str,
    conflict_groups: dict[str, list[str]],
    seed: int,
    limit: int | None = None,
) -> list[dict[str, Any]]:
    if not candidates:
        raise RuntimeError("No candidate assets matched the requested date coverage.")
    rng = random.Random(seed)
    cases: list[dict[str, Any]] = []
    by_symbol = {candidate.symbol: candidate for candidate in candidates}
    symbols = sorted(by_symbol)

    for years in windows_years:
        start_date = start_date_for_window(end_date, years)
        for basket_size in basket_sizes:
            if basket_size > len(symbols):
                raise RuntimeError(
                    f"Basket size {basket_size} exceeds candidate count {len(symbols)}."
                )
            for sample_index in range(samples_per_size):
                selected_symbols = draw_valid_symbols(
                    rng=rng,
                    symbols=symbols,
                    basket_size=basket_size,
                    conflict_groups=conflict_groups,
                )
                selected = [by_symbol[symbol] for symbol in selected_symbols]
                cases.append(
                    {
                        "caseId": case_id(selected_symbols, years, sample_index),
                        "windowYears": years,
                        "basketSize": basket_size,
                        "sampleIndex": sample_index,
                        "startDate": start_date,
                        "endDate": end_date,
                        "assetIds": [asset.id for asset in selected],
                        "symbols": selected_symbols,
                    }
                )
                if limit is not None and len(cases) >= limit:
                    return cases
    return cases


def draw_valid_symbols(
    *,
    rng: random.Random,
    symbols: list[str],
    basket_size: int,
    conflict_groups: dict[str, list[str]],
    max_attempts: int = 2000,
) -> list[str]:
    for _ in range(max_attempts):
        shuffled = symbols[:]
        rng.shuffle(shuffled)
        selected: list[str] = []
        for symbol in shuffled:
            candidate = [*selected, symbol]
            if not conflict_violations(candidate, conflict_groups):
                selected.append(symbol)
            if len(selected) == basket_size:
                return sorted(selected)
    raise RuntimeError(
        f"Could not draw a valid {basket_size}-asset basket after {max_attempts} attempts."
    )


def case_id(symbols: list[str], years: int, sample_index: int) -> str:
    payload = json.dumps(
        {"symbols": symbols, "years": years, "sampleIndex": sample_index},
        sort_keys=True,
    )
    digest = hashlib.sha1(payload.encode("utf-8")).hexdigest()[:12]
    return f"adm-{years}y-{sample_index:03d}-{digest}"


def clamp(value: float, lower: float = 0.0, upper: float = 1.0) -> float:
    return min(upper, max(lower, value))


def score_result(metrics: dict[str, Any], scoring: dict[str, Any]) -> float:
    sharpe = float(metrics.get("sharpeRatio", metrics.get("sharpe", 0)) or 0)
    max_drawdown = abs(float(metrics.get("maxDrawdown", 0) or 0))
    volatility = float(metrics.get("volatility", 0) or 0)
    sharpe_floor = float(scoring["sharpeFloor"])
    sharpe_ceiling = float(scoring["sharpeCeiling"])
    sharpe_component = clamp((sharpe - sharpe_floor) / (sharpe_ceiling - sharpe_floor))
    drawdown_component = clamp(1 - max_drawdown / float(scoring["maxDrawdownCeiling"]))
    volatility_component = clamp(1 - volatility / float(scoring["volatilityCeiling"]))
    score = 100 * (
        float(scoring["sharpeWeight"]) * sharpe_component
        + float(scoring["maxDrawdownWeight"]) * drawdown_component
        + float(scoring["volatilityWeight"]) * volatility_component
    )
    return round(score, 4)


def summarize_scores(rows: list[dict[str, Any]]) -> dict[str, Any]:
    successful = [
        row
        for row in rows
        if row.get("status") == "ok" and isinstance(row.get("score"), (int, float))
    ]
    failed = [row for row in rows if row.get("status") != "ok"]
    scores = sorted(float(row["score"]) for row in successful)
    return {
        "caseCount": len(rows),
        "successCount": len(successful),
        "failureCount": len(failed),
        "meanScore": round(sum(scores) / len(scores), 4) if scores else None,
        "p10Score": percentile(scores, 0.1),
        "p50Score": percentile(scores, 0.5),
        "p90Score": percentile(scores, 0.9),
    }


def percentile(sorted_values: list[float], ratio: float) -> float | None:
    if not sorted_values:
        return None
    index = min(
        len(sorted_values) - 1, max(0, math.floor((len(sorted_values) - 1) * ratio))
    )
    return round(sorted_values[index], 4)


def create_run_dir(output_root: Path, run_id: str | None = None) -> Path:
    today = datetime.now().strftime("%Y-%m-%d")
    resolved_run_id = run_id or datetime.now().strftime("%H%M%S")
    run_dir = output_root / today / resolved_run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    return run_dir


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)
        file.write("\n")
