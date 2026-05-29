from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from eval_lib import (
    REPO_ROOT,
    load_asset_candidates,
    load_json,
    parse_int_list,
    resolve_end_date,
    start_date_for_window,
    warmup_start_date,
)


SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULTS_PATH = SCRIPT_DIR / "config/eval-defaults.json"
CONFLICT_GROUPS_PATH = SCRIPT_DIR / "config/conflict-groups.json"
UNIVERSE_PATH = SCRIPT_DIR / "config/universe.json"
TS_RUNNER_PATH = SCRIPT_DIR / "adm_eval_runner.ts"
QUANTDESK_DIR = REPO_ROOT / "tools/desktop/quantdesk"


@dataclass(frozen=True)
class EvalConfigContext:
    basket_sizes: list[int]
    conflict_groups: dict[str, list[str]]
    defaults: dict[str, Any]
    end_date: str
    required_start: str
    strategy_config: dict[str, Any]
    universe: list[Any]
    windows_years: list[int]


def join_ints(values: list[int]) -> str:
    return ",".join(str(value) for value in values)


def resolve_eval_config_context(
    *, sizes: str, windows: str, end_date: str
) -> EvalConfigContext:
    defaults = load_json(DEFAULTS_PATH)
    conflict_groups = load_json(CONFLICT_GROUPS_PATH)
    basket_sizes = parse_int_list(sizes)
    windows_years = parse_int_list(windows)
    resolved_end_date = resolve_end_date(end_date)
    strategy_config = defaults["strategyConfig"]
    warmup_days = (
        max(
            int(strategy_config["longLookbackWeeks"]),
            int(strategy_config["shortLookbackWeeks"]),
        )
        + 4
    ) * 7
    earliest_start = start_date_for_window(resolved_end_date, max(windows_years))
    required_start = warmup_start_date(earliest_start, warmup_days)
    universe = load_asset_candidates(UNIVERSE_PATH)

    return EvalConfigContext(
        basket_sizes=basket_sizes,
        conflict_groups=conflict_groups,
        defaults=defaults,
        end_date=resolved_end_date,
        required_start=required_start,
        strategy_config=strategy_config,
        universe=universe,
        windows_years=windows_years,
    )
