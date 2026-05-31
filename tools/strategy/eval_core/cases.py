from __future__ import annotations

import hashlib
import json
import random
from datetime import date, timedelta
from typing import Any

from eval_core.contract import EvalCase


def start_date_for_window(end_date: str, years: int) -> str:
    end = date.fromisoformat(end_date)
    return (end - timedelta(days=365 * years)).isoformat()


def warmup_start_date(start_date: str, warmup_days: int) -> str:
    return (date.fromisoformat(start_date) - timedelta(days=warmup_days)).isoformat()


def case_id(
    symbols: list[str],
    years: int,
    sample_index: int,
    *,
    prefix: str = "eval",
    cadence: str | None = None,
) -> str:
    payload = {
        "sampleIndex": sample_index,
        "symbols": symbols,
        "years": years,
        **({"cadence": cadence} if cadence else {}),
    }
    digest = hashlib.sha1(
        json.dumps(payload, sort_keys=True).encode("utf-8")
    ).hexdigest()[:12]
    cadence_part = f"-{cadence}" if cadence else ""
    return f"{prefix}{cadence_part}-{years}y-{sample_index:03d}-{digest}"


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


def conflict_violations(
    symbols: list[str], conflict_groups: dict[str, list[str]]
) -> list[str]:
    symbol_set = set(symbols)
    violations: list[str] = []
    for name, group in conflict_groups.items():
        if len(symbol_set.intersection(group)) > 1:
            violations.append(name)
    return violations


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


def generate_unique_basket_cases(
    *,
    assets: list[dict[str, Any]],
    basket_sizes: list[int],
    cadences: list[str | None],
    end_date: str,
    limit: int | None,
    samples_per_cell: int,
    seed: int,
    windows_years: list[int],
    symbol_key: str = "symbol",
    id_key: str = "id",
) -> list[EvalCase]:
    symbols = sorted({str(asset[symbol_key]) for asset in assets})
    by_symbol = {str(asset[symbol_key]): asset for asset in assets}
    cases: list[EvalCase] = []
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
                    selected_assets = [by_symbol[symbol] for symbol in selected_symbols]
                    cases.append(
                        EvalCase(
                            case_id=case_id(
                                selected_symbols,
                                years,
                                sample_index,
                                cadence=cadence,
                            ),
                            symbols=selected_symbols,
                            start_date=start_date,
                            end_date=end_date,
                            basket_size=basket_size,
                            window_years=years,
                            sample_index=sample_index,
                            rebalance_cadence=cadence,
                            asset_ids=[
                                str(asset.get(id_key) or asset[symbol_key])
                                for asset in selected_assets
                            ],
                        )
                    )
                    if limit is not None and len(cases) >= limit:
                        return cases
    return cases


def generate_conflict_group_cases(
    *,
    assets: list[dict[str, Any]],
    basket_sizes: list[int],
    conflict_groups: dict[str, list[str]],
    end_date: str,
    limit: int | None,
    samples_per_size: int,
    seed: int,
    windows_years: list[int],
    symbol_key: str = "symbol",
    id_key: str = "id",
) -> list[EvalCase]:
    symbols = sorted({str(asset[symbol_key]) for asset in assets})
    by_symbol = {str(asset[symbol_key]): asset for asset in assets}
    cases: list[EvalCase] = []
    for years in windows_years:
        start_date = start_date_for_window(end_date, years)
        for basket_size in basket_sizes:
            if basket_size > len(symbols):
                raise RuntimeError(
                    f"Basket size {basket_size} exceeds candidate count {len(symbols)}."
                )
            for sample_index in range(samples_per_size):
                try:
                    selected_symbols = draw_valid_symbols(
                        rng=random.Random(seed + years * 1000 + basket_size + sample_index),
                        symbols=symbols,
                        basket_size=basket_size,
                        conflict_groups=conflict_groups,
                    )
                except RuntimeError as error:
                    cases.append(
                        EvalCase(
                            case_id=f"eval-{years}y-{sample_index:03d}-skipped-{basket_size}",
                            symbols=[],
                            start_date=start_date,
                            end_date=end_date,
                            basket_size=basket_size,
                            window_years=years,
                            sample_index=sample_index,
                            skip_reason=str(error),
                        )
                    )
                    if limit is not None and len(cases) >= limit:
                        return cases
                    continue
                selected_assets = [by_symbol[symbol] for symbol in selected_symbols]
                cases.append(
                    EvalCase(
                        case_id=case_id(
                            selected_symbols, years, sample_index, prefix="eval"
                        ),
                        symbols=selected_symbols,
                        start_date=start_date,
                        end_date=end_date,
                        basket_size=basket_size,
                        window_years=years,
                        sample_index=sample_index,
                        asset_ids=[
                            str(asset.get(id_key) or asset[symbol_key])
                            for asset in selected_assets
                        ],
                    )
                )
                if limit is not None and len(cases) >= limit:
                    return cases
    return cases
