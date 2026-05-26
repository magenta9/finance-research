#!/usr/bin/env python3
"""Rotation Prism deterministic analyzer entrypoint."""

from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
from dataclasses import dataclass
from datetime import date, timedelta
from statistics import mean
from typing import Any


DEFAULT_LOOKBACK_DAYS = 750
DEFAULT_MA_PERIOD = 242
DEFAULT_BOLLINGER_STD = 2.0
DEFAULT_RETURN_DIFF_WINDOW = 40
DEFAULT_RSI_PERIOD = 14
EXPECTED_CONTRACT_VERSION = "quant-data-cli.v1"


@dataclass(frozen=True)
class PricePoint:
    date: str
    close: float


@dataclass(frozen=True)
class Params:
    lookback_days: int = DEFAULT_LOOKBACK_DAYS
    ma_period: int = DEFAULT_MA_PERIOD
    bollinger_std: float = DEFAULT_BOLLINGER_STD
    return_diff_window: int = DEFAULT_RETURN_DIFF_WINDOW
    rsi_period: int = DEFAULT_RSI_PERIOD


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Analyze a Rotation Prism asset pair and emit script JSON evidence."
    )
    parser.add_argument(
        "--asset-a", required=True, help="Numerator asset name or code."
    )
    parser.add_argument(
        "--asset-b", required=True, help="Denominator asset name or code."
    )
    parser.add_argument(
        "--market-a", default="", help="Optional quant-data market for asset A."
    )
    parser.add_argument(
        "--market-b", default="", help="Optional quant-data market for asset B."
    )
    parser.add_argument("--start", help="Optional start date in YYYY-MM-DD format.")
    parser.add_argument(
        "--end", default=date.today().isoformat(), help="End date in YYYY-MM-DD format."
    )
    parser.add_argument(
        "--quant-data", default=os.environ.get("QUANT_DATA_CLI", "quant-data")
    )
    parser.add_argument("--quant-data-arg", action="append", default=[])
    parser.add_argument("--quant-data-cwd", default=os.getcwd())
    parser.add_argument("--fixture-provider", action="store_true")
    parser.add_argument("--lookback-days", type=int, default=DEFAULT_LOOKBACK_DAYS)
    parser.add_argument("--ma-period", type=int, default=DEFAULT_MA_PERIOD)
    parser.add_argument("--bollinger-std", type=float, default=DEFAULT_BOLLINGER_STD)
    parser.add_argument(
        "--return-diff-window", type=int, default=DEFAULT_RETURN_DIFF_WINDOW
    )
    parser.add_argument("--rsi-period", type=int, default=DEFAULT_RSI_PERIOD)
    return parser.parse_args()


def finite_number(value: Any) -> float | None:
    if value is None:
        return None
    try:
        number_value = float(value)
    except (TypeError, ValueError):
        return None
    return number_value if math.isfinite(number_value) else None


def rounded(value: float | None, digits: int = 6) -> float | None:
    if value is None or not math.isfinite(value):
        return None
    return round(value, digits)


def shift_days(date_text: str, days: int) -> str:
    return (strict_iso_date(date_text) + timedelta(days=days)).isoformat()


def strict_iso_date(date_text: str) -> date:
    if len(date_text) != 10 or date_text[4] != "-" or date_text[7] != "-":
        raise ValueError("date must be YYYY-MM-DD")
    return date.fromisoformat(date_text)


def rolling_mean(values: list[float | None], period: int) -> list[float | None]:
    result: list[float | None] = []
    for index in range(len(values)):
        window = values[index - period + 1 : index + 1]
        if len(window) != period or any(value is None for value in window):
            result.append(None)
            continue
        result.append(mean(value for value in window if value is not None))
    return result


def rolling_std(values: list[float | None], period: int) -> list[float | None]:
    result: list[float | None] = []
    for index in range(len(values)):
        window = values[index - period + 1 : index + 1]
        if len(window) != period or any(value is None for value in window):
            result.append(None)
            continue
        finite_window = [value for value in window if value is not None]
        avg = mean(finite_window)
        if len(finite_window) < 2:
            result.append(0.0)
            continue
        variance = sum((value - avg) ** 2 for value in finite_window) / (
            len(finite_window) - 1
        )
        result.append(math.sqrt(variance))
    return result


def pct_change(values: list[float], window: int) -> list[float | None]:
    result: list[float | None] = []
    for index, value in enumerate(values):
        if index < window or values[index - window] == 0:
            result.append(None)
            continue
        result.append((value / values[index - window]) - 1)
    return result


def percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    position = (len(ordered) - 1) * fraction
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[int(position)]
    weight = position - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def ratio_rsi(values: list[float], period: int) -> list[float | None]:
    alpha = 2 / (period + 1)
    result: list[float | None] = []
    avg_gain: float | None = None
    avg_loss: float | None = None
    for index, value in enumerate(values):
        if index == 0:
            result.append(None)
            continue
        delta = value - values[index - 1]
        gain = max(delta, 0.0)
        loss = max(-delta, 0.0)
        avg_gain = gain if avg_gain is None else (gain - avg_gain) * alpha + avg_gain
        avg_loss = loss if avg_loss is None else (loss - avg_loss) * alpha + avg_loss
        if index < period or avg_gain is None or avg_loss is None:
            result.append(None)
        elif avg_gain == 0 and avg_loss == 0:
            result.append(50.0)
        elif avg_loss == 0:
            result.append(100.0)
        else:
            rs = avg_gain / avg_loss
            result.append(100 - (100 / (1 + rs)))
    return result


def normalize_price_rows(rows: list[dict[str, Any]]) -> list[PricePoint]:
    points: list[PricePoint] = []
    for row in rows:
        close = finite_number(row.get("calculationClose"))
        if not row.get("date") or close is None:
            continue
        points.append(PricePoint(date=str(row["date"]), close=close))
    return sorted(points, key=lambda item: item.date)


def align_price_points(
    rows_a: list[PricePoint], rows_b: list[PricePoint]
) -> tuple[list[PricePoint], list[PricePoint], list[dict[str, str]]]:
    dates_a = {row.date for row in rows_a}
    dates_b = {row.date for row in rows_b}
    shared = dates_a & dates_b
    gaps = []
    if not shared:
        return (
            [],
            [],
            [
                {
                    "code": "date_alignment_mismatch",
                    "message": "两个标的的交易日无任何交集，无法计算比值。",
                }
            ],
        )
    if shared != dates_a or shared != dates_b:
        gaps.append(
            {
                "code": "date_alignment_partial",
                "message": f"两个标的交易日不同步（A股 {len(dates_a)} 天，港股 {len(dates_b)} 天，共同 {len(shared)} 天），取共同日期计算。",
            }
        )
    by_date_a = {row.date: row for row in rows_a}
    by_date_b = {row.date: row for row in rows_b}
    dates = sorted(shared)
    return (
        [by_date_a[item] for item in dates],
        [by_date_b[item] for item in dates],
        gaps,
    )


def direction_from_votes(votes: list[str]) -> str:
    asset_a_votes = votes.count("asset_a")
    asset_b_votes = votes.count("asset_b")
    if asset_a_votes >= 2 and asset_a_votes > asset_b_votes:
        return "asset_a"
    if asset_b_votes >= 2 and asset_b_votes > asset_a_votes:
        return "asset_b"
    return "neutral"


def params_to_json(params: Params) -> dict[str, Any]:
    return {
        "lookbackDays": params.lookback_days,
        "maPeriod": params.ma_period,
        "bollingerStd": params.bollinger_std,
        "returnDiffWindow": params.return_diff_window,
        "rsiPeriod": params.rsi_period,
    }


def validate_analysis_inputs(
    args: argparse.Namespace, params: Params
) -> list[dict[str, str]]:
    gaps: list[dict[str, str]] = []
    parsed_start: date | None = None
    parsed_end: date | None = None
    if args.start:
        try:
            parsed_start = strict_iso_date(args.start)
        except ValueError:
            gaps.append(
                {
                    "code": "invalid_input",
                    "message": f"start 必须是 YYYY-MM-DD：{args.start}",
                }
            )
    try:
        parsed_end = strict_iso_date(args.end)
    except ValueError:
        gaps.append(
            {"code": "invalid_input", "message": f"end 必须是 YYYY-MM-DD：{args.end}"}
        )
    if (
        parsed_start is not None
        and parsed_end is not None
        and parsed_start > parsed_end
    ):
        gaps.append({"code": "invalid_input", "message": "start 必须早于或等于 end。"})
    if params.lookback_days <= 0:
        gaps.append({"code": "invalid_input", "message": "lookback-days 必须大于 0。"})
    if params.ma_period <= 1:
        gaps.append({"code": "invalid_input", "message": "ma-period 必须大于 1。"})
    if params.bollinger_std <= 0:
        gaps.append({"code": "invalid_input", "message": "bollinger-std 必须大于 0。"})
    if params.return_diff_window <= 0:
        gaps.append(
            {"code": "invalid_input", "message": "return-diff-window 必须大于 0。"}
        )
    if params.rsi_period <= 1:
        gaps.append({"code": "invalid_input", "message": "rsi-period 必须大于 1。"})
    return gaps


def unavailable_result(
    *,
    asset_a: dict[str, Any],
    asset_b: dict[str, Any],
    data_gaps: list[dict[str, str]],
    params: Params,
) -> dict[str, Any]:
    return {
        "assetA": asset_a,
        "assetB": asset_b,
        "ratioDirection": "asset_a/asset_b",
        "status": "unavailable",
        "favor": "neutral",
        "grade": "unavailable",
        "trendDirection": "neutral",
        "parameters": params_to_json(params),
        "latestMetrics": {},
        "trendEvidence": [],
        "meanReversionEvidence": [],
        "dataGaps": data_gaps,
        "nonExecution": True,
    }


def analyze_price_points(
    *,
    asset_a: dict[str, Any],
    asset_b: dict[str, Any],
    rows_a: list[PricePoint],
    rows_b: list[PricePoint],
    params: Params,
) -> dict[str, Any]:
    aligned_a, aligned_b, data_gaps = align_price_points(rows_a, rows_b)
    minimum_bars = max(
        params.ma_period + params.return_diff_window, params.rsi_period + 1
    )
    critical_gaps = [g for g in data_gaps if g["code"] != "date_alignment_partial"]
    warnings = [g for g in data_gaps if g["code"] == "date_alignment_partial"]
    if critical_gaps or len(aligned_a) < minimum_bars:
        gaps = critical_gaps or [
            {
                "code": "insufficient_calculation_coverage",
                "message": f"至少需要 {minimum_bars} 个对齐日频收盘点，当前只有 {len(aligned_a)} 个。",
            }
        ]
        return unavailable_result(
            asset_a=asset_a, asset_b=asset_b, data_gaps=gaps, params=params
        )

    closes_a = [row.close for row in aligned_a]
    closes_b = [row.close for row in aligned_b]
    ratios = [closes_a[index] / closes_b[index] for index in range(len(closes_a))]
    ratio_ma = rolling_mean(ratios, params.ma_period)
    ratio_std = rolling_std(ratios, params.ma_period)
    upper_band = [
        None
        if ratio_ma[index] is None or ratio_std[index] is None
        else ratio_ma[index] + params.bollinger_std * ratio_std[index]
        for index in range(len(ratios))
    ]
    lower_band = [
        None
        if ratio_ma[index] is None or ratio_std[index] is None
        else ratio_ma[index] - params.bollinger_std * ratio_std[index]
        for index in range(len(ratios))
    ]

    returns_a = pct_change(closes_a, params.return_diff_window)
    returns_b = pct_change(closes_b, params.return_diff_window)
    return_diff = [
        None
        if returns_a[index] is None or returns_b[index] is None
        else returns_a[index] - returns_b[index]
        for index in range(len(returns_a))
    ]
    return_diff_ma = rolling_mean(return_diff, params.ma_period)
    rsi = ratio_rsi(ratios, params.rsi_period)
    rsi_ma = rolling_mean(rsi, params.ma_period)

    latest_index = len(ratios) - 1
    latest_date = aligned_a[latest_index].date
    trend_votes: list[str] = []
    trend_evidence: list[dict[str, Any]] = []
    mean_reversion_evidence: list[dict[str, Any]] = []

    latest_ratio = ratios[latest_index]
    latest_upper = upper_band[latest_index]
    latest_lower = lower_band[latest_index]
    latest_ratio_ma = ratio_ma[latest_index]
    if latest_upper is not None and latest_ratio > latest_upper:
        trend_votes.append("asset_a")
        trend_evidence.append(
            {
                "id": "S1-UP",
                "direction": "asset_a",
                "message": "比值高于年线布林上轨，asset_a 相对走强。",
            }
        )
    elif latest_lower is not None and latest_ratio < latest_lower:
        trend_votes.append("asset_b")
        trend_evidence.append(
            {
                "id": "S1-DOWN",
                "direction": "asset_b",
                "message": "比值低于年线布林下轨，asset_b 相对走强。",
            }
        )
    elif latest_ratio_ma is not None:
        if latest_ratio > latest_ratio_ma:
            direction = "asset_a"
        elif latest_ratio < latest_ratio_ma:
            direction = "asset_b"
        else:
            direction = "neutral"
        if direction != "neutral":
            trend_votes.append(direction)
            trend_evidence.append(
                {
                    "id": "S1-MA-SIDE",
                    "direction": direction,
                    "message": "比值位于年线一侧，作为弱趋势证据。",
                }
            )

    latest_return_diff_ma = return_diff_ma[latest_index]
    if latest_return_diff_ma is not None:
        if latest_return_diff_ma > 0:
            direction = "asset_a"
        elif latest_return_diff_ma < 0:
            direction = "asset_b"
        else:
            direction = "neutral"
        if direction != "neutral":
            trend_votes.append(direction)
            trend_evidence.append(
                {
                    "id": "S2-MA",
                    "direction": direction,
                    "message": "40日收益差年线位于 0 轴一侧。",
                }
            )

    latest_rsi_ma = rsi_ma[latest_index]
    if latest_rsi_ma is not None:
        if latest_rsi_ma > 50:
            direction = "asset_a"
        elif latest_rsi_ma < 50:
            direction = "asset_b"
        else:
            direction = "neutral"
        if direction != "neutral":
            trend_votes.append(direction)
            trend_evidence.append(
                {
                    "id": "S3-RSI-MA",
                    "direction": direction,
                    "message": "比值 RSI 年线位于 50 轴一侧。",
                }
            )

    historical_return_diff = [value for value in return_diff if value is not None]
    latest_return_diff = return_diff[latest_index]
    return_low = percentile(historical_return_diff, 0.05)
    return_high = percentile(historical_return_diff, 0.95)
    if (
        latest_return_diff is not None
        and return_low is not None
        and return_high is not None
        and return_low < return_high
        and latest_return_diff < return_low
    ):
        mean_reversion_evidence.append(
            {
                "id": "S2-EXTREME-LOW",
                "direction": "asset_a",
                "message": "40日收益差处于历史低位，asset_a 阶段性跑输。",
            }
        )
    elif (
        latest_return_diff is not None
        and return_low is not None
        and return_high is not None
        and return_low < return_high
        and latest_return_diff > return_high
    ):
        mean_reversion_evidence.append(
            {
                "id": "S2-EXTREME-HIGH",
                "direction": "asset_b",
                "message": "40日收益差处于历史高位，asset_b 阶段性跑输。",
            }
        )

    historical_rsi = [value for value in rsi if value is not None]
    latest_rsi = rsi[latest_index]
    rsi_low = percentile(historical_rsi, 0.05)
    rsi_high = percentile(historical_rsi, 0.95)
    if (
        latest_rsi is not None
        and rsi_low is not None
        and rsi_high is not None
        and rsi_low < rsi_high
        and latest_rsi < rsi_low
    ):
        mean_reversion_evidence.append(
            {
                "id": "S3-RSI-LOW",
                "direction": "asset_a",
                "message": "比值 RSI 处于历史低位，asset_a 阶段性超跌。",
            }
        )
    elif (
        latest_rsi is not None
        and rsi_low is not None
        and rsi_high is not None
        and rsi_low < rsi_high
        and latest_rsi > rsi_high
    ):
        mean_reversion_evidence.append(
            {
                "id": "S3-RSI-HIGH",
                "direction": "asset_b",
                "message": "比值 RSI 处于历史高位，asset_b 阶段性超跌。",
            }
        )

    trend_direction = direction_from_votes(trend_votes)
    mean_directions = [str(item["direction"]) for item in mean_reversion_evidence]
    mean_triggered = (
        trend_direction in mean_directions
        if trend_direction != "neutral"
        else bool(mean_directions)
    )
    if trend_direction != "neutral" and mean_triggered:
        grade = "A"
        favor = trend_direction
    elif trend_direction != "neutral":
        grade = "B"
        favor = trend_direction
    elif mean_reversion_evidence:
        grade = "C"
        favor = "neutral"
    else:
        grade = "unavailable"
        favor = "neutral"

    return {
        "assetA": asset_a,
        "assetB": asset_b,
        "ratioDirection": "asset_a/asset_b",
        "status": "available",
        "asOf": latest_date,
        "favor": favor,
        "grade": grade,
        "trendDirection": trend_direction,
        "parameters": params_to_json(params),
        "latestMetrics": {
            "ratio": rounded(latest_ratio),
            "ratioMa": rounded(latest_ratio_ma),
            "upperBand": rounded(latest_upper),
            "lowerBand": rounded(latest_lower),
            "returnDiff40": rounded(latest_return_diff),
            "returnDiffMa": rounded(latest_return_diff_ma),
            "ratioRsi": rounded(latest_rsi),
            "ratioRsiMa": rounded(latest_rsi_ma),
        },
        "trendEvidence": trend_evidence,
        "meanReversionEvidence": mean_reversion_evidence,
        "dataGaps": warnings,
        "nonExecution": True,
    }


def run_quant_data(
    args: argparse.Namespace, method: str, payload: dict[str, Any]
) -> dict[str, Any]:
    command = [args.quant_data, *args.quant_data_arg, method]
    env = os.environ.copy()
    if args.fixture_provider:
        env["QUANT_DATA_FIXTURE_PROVIDER"] = "1"
    try:
        process = subprocess.run(
            command,
            input=json.dumps(payload, ensure_ascii=False) + "\n",
            text=True,
            cwd=args.quant_data_cwd,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
    except OSError as error:
        raise RuntimeError(f"quant-data {method} could not start: {error}") from error
    if process.returncode != 0:
        detail = process.stderr.strip() or process.stdout.strip() or "no output"
        raise RuntimeError(
            f"quant-data {method} exited with {process.returncode}: {detail}"
        )
    try:
        envelope = json.loads(process.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError(
            f"quant-data {method} returned invalid JSON: {error}"
        ) from error
    if not isinstance(envelope, dict):
        raise RuntimeError(f"quant-data {method} returned non-object JSON envelope")
    return envelope


def check_quant_data(args: argparse.Namespace) -> list[dict[str, str]]:
    command = [args.quant_data, *args.quant_data_arg, "help", "--json"]
    env = os.environ.copy()
    if args.fixture_provider:
        env["QUANT_DATA_FIXTURE_PROVIDER"] = "1"
    try:
        process = subprocess.run(
            command,
            text=True,
            cwd=args.quant_data_cwd,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
    except OSError as error:
        return [
            {
                "code": "quant_data_cli_missing",
                "message": f"quant-data CLI 无法启动：{error}。请先运行 make quant-data-install，或通过 --quant-data 指定可执行文件路径。",
            }
        ]
    if process.returncode != 0:
        detail = process.stderr.strip() or process.stdout.strip() or "no output"
        return [
            {
                "code": "quant_data_cli_unavailable",
                "message": f"quant-data CLI 检查失败：{detail}",
            }
        ]
    try:
        payload = json.loads(process.stdout)
    except json.JSONDecodeError:
        return [
            {
                "code": "quant_data_cli_incompatible",
                "message": "quant-data help --json 未返回合法 JSON，无法确认 contract。",
            }
        ]
    if (
        not isinstance(payload, dict)
        or payload.get("contractVersion") != EXPECTED_CONTRACT_VERSION
    ):
        return [
            {
                "code": "quant_data_cli_incompatible",
                "message": f"quant-data contractVersion 必须是 {EXPECTED_CONTRACT_VERSION}。请更新或重新安装 quant-data CLI。",
            }
        ]
    methods = payload.get("methods") if isinstance(payload, dict) else None
    method_names = {
        str(item.get("name"))
        for item in methods or []
        if isinstance(item, dict) and item.get("name")
    }
    required = {"search-assets", "get-price-series"}
    missing = sorted(required - method_names)
    if missing:
        return [
            {
                "code": "quant_data_cli_incompatible",
                "message": f"quant-data contract 缺少方法：{', '.join(missing)}。请更新或重新安装 quant-data CLI。",
            }
        ]
    return []


def resolve_asset(
    args: argparse.Namespace, query: str, market: str
) -> tuple[dict[str, Any] | None, list[dict[str, str]]]:
    payload = {"query": query}
    # tsCode formats (e.g. "399006.SZ", "^HSTECH") already encode market;
    # passing market separately can cause ambiguity (e.g. market=A with "399006.SZ"
    # returns both "399006" and "399006.SZ"). Only use market for name queries.
    is_ts_code = any(
        x in query for x in (".SZ", ".CSI", ".SH", ".HK", ".BJ")
    ) or query.startswith("^")
    if market and not is_ts_code:
        payload["market"] = market
    envelope = run_quant_data(args, "search-assets", payload)
    if not envelope.get("ok"):
        error = envelope.get("maintenanceError") or {}
        return None, [
            {
                "code": str(error.get("code") or "asset_search_failed"),
                "message": str(error.get("message") or "标的解析失败。"),
            }
        ]
    assets = envelope.get("data")
    if assets is None:
        assets = []
    if not isinstance(assets, list) or any(not isinstance(asset, dict) for asset in assets):
        return None, [
            {
                "code": "asset_search_invalid_response",
                "message": "quant-data search-assets 返回的 data 必须是标的数组。",
            }
        ]
    if not assets:
        return None, [{"code": "asset_not_found", "message": f"未解析到标的：{query}"}]

    if len(assets) == 1:
        return assets[0], []

    return None, [
        {
            "code": "asset_ambiguous",
            "message": f"标的解析存在歧义：{query}，请提供更精确的代码或 market。",
        }
    ]


def fetch_prices(
    args: argparse.Namespace, asset: dict[str, Any], start: str, end: str
) -> tuple[list[PricePoint], list[dict[str, str]]]:
    payload = {
        "symbol": asset.get("symbol"),
        "market": asset.get("market"),
        "start": start,
        "end": end,
    }
    envelope = run_quant_data(args, "get-price-series", payload)
    if not envelope.get("ok"):
        error = envelope.get("maintenanceError") or {}
        return [], [
            {
                "code": str(error.get("code") or "price_fetch_failed"),
                "message": str(error.get("message") or "价格序列获取失败。"),
            }
        ]
    data = envelope.get("data")
    if data is None:
        data = {}
    if not isinstance(data, dict):
        return [], [
            {
                "code": "price_fetch_invalid_response",
                "message": "quant-data get-price-series 返回的 data 必须是对象。",
            }
        ]
    price_rows = data.get("prices")
    if price_rows is None:
        price_rows = []
    if not isinstance(price_rows, list) or any(
        not isinstance(row, dict) for row in price_rows
    ):
        return [], [
            {
                "code": "price_fetch_invalid_response",
                "message": "quant-data get-price-series 返回的 prices 必须是数组。",
            }
        ]
    rows = normalize_price_rows(price_rows)
    if not rows:
        return [], [
            {
                "code": "price_series_empty",
                "message": f"价格序列为空：{asset.get('symbol')}",
            }
        ]
    return rows, []


def analyze(args: argparse.Namespace) -> dict[str, Any]:
    params = Params(
        lookback_days=args.lookback_days,
        ma_period=args.ma_period,
        bollinger_std=args.bollinger_std,
        return_diff_window=args.return_diff_window,
        rsi_period=args.rsi_period,
    )
    asset_a_query = {"query": args.asset_a}
    asset_b_query = {"query": args.asset_b}
    input_gaps = validate_analysis_inputs(args, params)
    if input_gaps:
        return unavailable_result(
            asset_a=asset_a_query,
            asset_b=asset_b_query,
            data_gaps=input_gaps,
            params=params,
        )
    start = args.start or shift_days(args.end, -args.lookback_days)
    cli_gaps = check_quant_data(args)
    if cli_gaps:
        return unavailable_result(
            asset_a=asset_a_query,
            asset_b=asset_b_query,
            data_gaps=cli_gaps,
            params=params,
        )
    try:
        asset_a, gaps_a = resolve_asset(args, args.asset_a, args.market_a)
        asset_b, gaps_b = resolve_asset(args, args.asset_b, args.market_b)
        if gaps_a or gaps_b or asset_a is None or asset_b is None:
            return unavailable_result(
                asset_a=asset_a or asset_a_query,
                asset_b=asset_b or asset_b_query,
                data_gaps=[*gaps_a, *gaps_b],
                params=params,
            )
        rows_a, price_gaps_a = fetch_prices(args, asset_a, start, args.end)
        rows_b, price_gaps_b = fetch_prices(args, asset_b, start, args.end)
    except RuntimeError as error:
        return unavailable_result(
            asset_a=asset_a_query,
            asset_b=asset_b_query,
            data_gaps=[{"code": "quant_data_invocation_failed", "message": str(error)}],
            params=params,
        )

    if price_gaps_a or price_gaps_b:
        return unavailable_result(
            asset_a=asset_a,
            asset_b=asset_b,
            data_gaps=[*price_gaps_a, *price_gaps_b],
            params=params,
        )
    return analyze_price_points(
        asset_a=asset_a, asset_b=asset_b, rows_a=rows_a, rows_b=rows_b, params=params
    )


def main() -> int:
    args = parse_args()
    print(json.dumps(analyze(args), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
