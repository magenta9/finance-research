from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

TIMEFRAMES = ["1d", "2d", "1w", "2w"]
MIN_BARS = 80
EMA_PERIOD = 50
ATR_PERIOD = 14
MACD_FAST = 12
MACD_SLOW = 26
MACD_SIGNAL = 9
EMA_DISTANCE_ATR_THRESHOLD = 1.0
MACD_ZERO_ATR_THRESHOLD = 0.5
STATUS_LABELS = {
    "unavailable": "无法判断",
    "no_trend": "趋势不明确",
    "away": "有趋势但未到观察位",
    "observation_zone": "到达趋势观察位",
}
DIRECTION_LABELS = {
    "long": "多头",
    "short": "空头",
    "neutral": "中性",
    "mixed": "多空混杂",
}
CONSISTENCY_LABELS = {
    "aligned": "方向一致",
    "mixed": "多空混杂",
    "none": "无明确方向",
    "unknown": "无法判断",
}


@dataclass(frozen=True)
class Bar:
    date: str
    open: float
    high: float
    low: float
    close: float
    source: str
    volume: float | None = None


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


def label_timeframe(item: dict[str, Any]) -> dict[str, Any]:
    return {
        **item,
        "directionLabel": DIRECTION_LABELS.get(
            item.get("direction"), str(item.get("direction"))
        ),
        "statusLabel": STATUS_LABELS.get(item.get("status"), str(item.get("status"))),
    }


def label_overall(item: dict[str, Any]) -> dict[str, Any]:
    return {
        **item,
        "directionConsistencyLabel": CONSISTENCY_LABELS.get(
            item.get("directionConsistency"), str(item.get("directionConsistency"))
        ),
        "directionLabel": DIRECTION_LABELS.get(
            item.get("direction"), str(item.get("direction"))
        ),
        "statusLabel": STATUS_LABELS.get(item.get("status"), str(item.get("status"))),
    }


def normalize_rows(rows: list[dict[str, Any]]) -> list[Bar]:
    bars: list[Bar] = []
    for row in rows:
        close = finite_number(
            row.get("calculationClose") or row.get("adjustedClose") or row.get("close")
        )
        open_value = finite_number(
            row.get("open") if row.get("open") is not None else close
        )
        high = finite_number(row.get("high") if row.get("high") is not None else close)
        low = finite_number(row.get("low") if row.get("low") is not None else close)
        if (
            not row.get("date")
            or close is None
            or open_value is None
            or high is None
            or low is None
        ):
            continue
        bars.append(
            Bar(
                close=close,
                date=str(row["date"]),
                high=max(high, open_value, close),
                low=min(low, open_value, close),
                open=open_value,
                source=str(row.get("source") or "unknown"),
                volume=finite_number(row.get("volume")),
            )
        )
    return sorted(bars, key=lambda item: item.date)


def merge_group(group: list[Bar]) -> Bar:
    first = group[0]
    last = group[-1]
    volumes = [item.volume for item in group if item.volume is not None]
    return Bar(
        close=last.close,
        date=last.date,
        high=max(item.high for item in group),
        low=min(item.low for item in group),
        open=first.open,
        source=",".join(sorted({item.source for item in group})),
        volume=sum(volumes) if volumes else None,
    )


def iso_week_index(date_text: str) -> int:
    parsed = datetime.fromisoformat(date_text).date()
    iso_year, iso_week, _ = parsed.isocalendar()
    return iso_year * 53 + iso_week


def group_key(bar: Bar, timeframe: str, index: int) -> str:
    if timeframe == "1d":
        return bar.date
    if timeframe == "2d":
        return str(index // 2)
    if timeframe == "1w":
        return str(iso_week_index(bar.date))
    if timeframe == "2w":
        return str(iso_week_index(bar.date) // 2)
    if timeframe == "1mo":
        return bar.date[:7]
    raise ValueError(f"Unsupported timeframe: {timeframe}")


def aggregate_bars(daily_bars: list[Bar], timeframe: str) -> list[Bar]:
    if timeframe == "1d":
        return daily_bars
    groups: list[Bar] = []
    current_key: str | None = None
    current_group: list[Bar] = []
    for index, bar in enumerate(daily_bars):
        key = group_key(bar, timeframe, index)
        if current_key is None or key == current_key:
            current_key = key
            current_group.append(bar)
            continue
        groups.append(merge_group(current_group))
        current_key = key
        current_group = [bar]
    if current_group:
        groups.append(merge_group(current_group))
    return groups


def ema(values: list[float], period: int) -> list[float | None]:
    multiplier = 2 / (period + 1)
    result: list[float | None] = []
    previous: float | None = None
    for value in values:
        previous = (
            value if previous is None else (value - previous) * multiplier + previous
        )
        result.append(previous)
    return result


def atr(rows: list[Bar], period: int) -> list[float | None]:
    true_ranges: list[float] = []
    for index, row in enumerate(rows):
        previous_close = rows[index - 1].close if index > 0 else row.close
        true_ranges.append(
            max(
                row.high - row.low,
                abs(row.high - previous_close),
                abs(row.low - previous_close),
            )
        )

    result: list[float | None] = []
    previous: float | None = None
    for index, value in enumerate(true_ranges):
        if index < period - 1:
            result.append(None)
            continue
        if index == period - 1:
            previous = sum(true_ranges[:period]) / period
        elif previous is not None:
            previous = ((previous * (period - 1)) + value) / period
        result.append(previous)
    return result


def macd(values: list[float]) -> dict[str, list[float | None]]:
    fast = ema(values, MACD_FAST)
    slow = ema(values, MACD_SLOW)
    line = [
        None
        if fast[index] is None or slow[index] is None
        else fast[index] - slow[index]
        for index in range(len(values))
    ]
    signal = ema([value or 0 for value in line], MACD_SIGNAL)
    histogram = [
        None
        if line[index] is None or signal[index] is None
        else line[index] - signal[index]
        for index in range(len(values))
    ]
    return {"histogram": histogram, "line": line, "signal": signal}


def all_finite(*values: float | None) -> bool:
    return all(value is not None and math.isfinite(value) for value in values)


def unavailable_result(
    *,
    asset_id: str = "",
    data_gaps: list[str],
    end: str | None = None,
    market: str = "",
    start: str | None = None,
    symbol: str = "",
) -> dict[str, Any]:
    return {
        "dataGaps": data_gaps,
        "meta": {
            "assetId": asset_id or None,
            "end": end,
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "market": market,
            "source": "quant-data",
            "start": start,
            "symbol": symbol,
        },
        "overall": label_overall(
            {
                "direction": "neutral",
                "directionConsistency": "unknown",
                "reasons": data_gaps,
                "status": "unavailable",
                "strongestTimeframe": None,
            }
        ),
        "timeframes": [
            label_timeframe(
                {
                    "barCount": 0,
                    "dataGaps": data_gaps,
                    "direction": "neutral",
                    "metrics": {},
                    "reasons": ["数据不可用，无法判断趋势观察位。"],
                    "status": "unavailable",
                    "timeframe": timeframe,
                }
            )
            for timeframe in TIMEFRAMES
        ],
    }


def analyze_timeframe(daily_bars: list[Bar], timeframe: str) -> dict[str, Any]:
    bars = aggregate_bars(daily_bars, timeframe)
    data_gaps: list[str] = []
    if len(bars) < MIN_BARS:
        data_gaps.append(
            f"{timeframe}: needs at least {MIN_BARS} aggregated bars, got {len(bars)}"
        )
        return {
            "barCount": len(bars),
            "dataGaps": data_gaps,
            "direction": "neutral",
            "metrics": {},
            "reasons": ["聚合 bar 数不足，无法判断趋势观察位。"],
            "status": "unavailable",
            "timeframe": timeframe,
        }

    closes = [bar.close for bar in bars]
    ema50 = ema(closes, EMA_PERIOD)
    atr14 = atr(bars, ATR_PERIOD)
    macd_values = macd(closes)
    last_index = len(bars) - 1
    slope_index = max(0, last_index - 5)
    last = bars[last_index]
    last_ema = ema50[last_index]
    prior_ema = ema50[slope_index]
    last_atr = atr14[last_index]
    macd_line = macd_values["line"][last_index]
    macd_signal = macd_values["signal"][last_index]
    macd_histogram = macd_values["histogram"][last_index]

    if (
        not all_finite(
            last.close,
            last_ema,
            prior_ema,
            last_atr,
            macd_line,
            macd_signal,
            macd_histogram,
        )
        or (last_atr or 0) <= 0
    ):
        data_gaps.append(
            f"{timeframe}: insufficient indicator prerequisites at latest bar"
        )
        return {
            "barCount": len(bars),
            "dataGaps": data_gaps,
            "direction": "neutral",
            "metrics": {"asOf": last.date},
            "reasons": ["最新 bar 的 EMA、ATR 或 MACD 前置条件不足。"],
            "status": "unavailable",
            "timeframe": timeframe,
        }

    ema_slope = (last_ema or 0) - (prior_ema or 0)
    distance_to_ema50_atr = abs(last.close - (last_ema or 0)) / (last_atr or 1)
    macd_line_atr = abs(macd_line or 0) / (last_atr or 1)
    long_trend = last.close > (last_ema or 0) and ema_slope > 0
    short_trend = last.close < (last_ema or 0) and ema_slope < 0
    price_near_ema = distance_to_ema50_atr <= EMA_DISTANCE_ATR_THRESHOLD
    macd_near_zero = macd_line_atr <= MACD_ZERO_ATR_THRESHOLD

    status = "no_trend"
    direction = "neutral"
    reasons: list[str] = []
    if long_trend:
        direction = "long"
        reasons.append("收盘价位于 EMA50 上方，EMA50 斜率向上。")
    elif short_trend:
        direction = "short"
        reasons.append("收盘价位于 EMA50 下方，EMA50 斜率向下。")
    else:
        reasons.append("价格与 EMA50 斜率没有形成一致的趋势方向。")

    if direction != "neutral":
        if price_near_ema:
            reasons.append(
                f"价格距 EMA50 为 {rounded(distance_to_ema50_atr, 3)} ATR，接近观察区域。"
            )
        else:
            reasons.append(
                f"价格距 EMA50 为 {rounded(distance_to_ema50_atr, 3)} ATR，尚未回到观察区域。"
            )
        if macd_near_zero:
            reasons.append(
                f"MACD 线距零轴为 {rounded(macd_line_atr, 3)} ATR，接近零轴重置区域。"
            )
        else:
            reasons.append(
                f"MACD 线距零轴为 {rounded(macd_line_atr, 3)} ATR，尚未接近零轴重置区域。"
            )
        status = "observation_zone" if price_near_ema and macd_near_zero else "away"

    return {
        "barCount": len(bars),
        "dataGaps": data_gaps,
        "direction": direction,
        "metrics": {
            "asOf": last.date,
            "atr": rounded(last_atr),
            "close": rounded(last.close),
            "distanceToEma50Atr": rounded(distance_to_ema50_atr),
            "ema50": rounded(last_ema),
            "ema50Slope5": rounded(ema_slope),
            "macdHistogram": rounded(macd_histogram),
            "macdLine": rounded(macd_line),
            "macdLineAtr": rounded(macd_line_atr),
            "macdSignal": rounded(macd_signal),
        },
        "reasons": reasons,
        "status": status,
        "timeframe": timeframe,
    }


def summarize_overall(timeframes: list[dict[str, Any]]) -> dict[str, Any]:
    usable = [item for item in timeframes if item["status"] != "unavailable"]
    observations = [item for item in timeframes if item["status"] == "observation_zone"]
    trends = [
        item for item in timeframes if item["status"] in {"observation_zone", "away"}
    ]
    direction_set = {
        item["direction"] for item in trends if item["direction"] != "neutral"
    }
    priority = {"1mo": 0, "2w": 1, "1w": 2, "2d": 3, "1d": 4}
    strongest = (
        sorted(observations, key=lambda item: priority[item["timeframe"]])[0]
        if observations
        else None
    )

    if all(item["status"] == "unavailable" for item in timeframes):
        return {
            "direction": "neutral",
            "directionConsistency": "none",
            "reasons": ["所有观察周期都不可用。"],
            "status": "unavailable",
            "strongestTimeframe": None,
        }
    if strongest:
        return {
            "direction": strongest["direction"],
            "directionConsistency": "aligned" if len(direction_set) == 1 else "mixed",
            "reasons": [
                f"{strongest['timeframe']} 处于 {strongest['direction']} 趋势观察位。"
            ],
            "status": "observation_zone",
            "strongestTimeframe": strongest["timeframe"],
        }
    if trends:
        direction = next(iter(direction_set)) if len(direction_set) == 1 else "mixed"
        return {
            "direction": direction,
            "directionConsistency": "aligned" if len(direction_set) == 1 else "mixed",
            "reasons": ["存在趋势周期，但尚未回到观察区域。"],
            "status": "away",
            "strongestTimeframe": None,
        }
    return {
        "direction": "neutral",
        "directionConsistency": "none" if usable else "unknown",
        "reasons": ["可用周期未形成明确趋势。"],
        "status": "no_trend",
        "strongestTimeframe": None,
    }


def analyze_rows(
    *,
    asset_id: str,
    end: str,
    envelope: dict[str, Any],
    market: str,
    rows: list[Bar],
    start: str,
    symbol: str,
) -> dict[str, Any]:
    timeframes = [
        label_timeframe(analyze_timeframe(rows, timeframe)) for timeframe in TIMEFRAMES
    ]
    data = envelope.get("data")
    if not isinstance(data, dict):
        data = {}
    warnings = data.get("warnings")
    if not isinstance(warnings, list):
        warnings = []
    data_gaps = [
        f"quant-data warning: {warning}" for warning in warnings
    ]
    data_gaps.extend(gap for item in timeframes for gap in item["dataGaps"])
    return {
        "dataGaps": data_gaps,
        "meta": {
            "assetId": asset_id or None,
            "attemptedSources": data.get("attemptedSources") if isinstance(data.get("attemptedSources"), list) else [],
            "dataQualityStatus": envelope.get("dataQualityStatus"),
            "end": end,
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "latestDate": rows[-1].date,
            "market": market,
            "providerStatus": envelope.get("providerStatus"),
            "resultProvenance": envelope.get("resultProvenance"),
            "rowCount": len(rows),
            "source": "quant-data",
            "start": start,
            "symbol": data.get("symbol") or symbol,
        },
        "overall": label_overall(summarize_overall(timeframes)),
        "timeframes": timeframes,
    }
