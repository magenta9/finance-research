from __future__ import annotations

from datetime import date, timedelta
from typing import Any


def price_rows_cover_window(prices: list[dict[str, Any]], start: str, end: str) -> bool:
    if not prices:
        return False

    try:
        start_date = date.fromisoformat(start)
        end_date = date.fromisoformat(end)
        price_dates = sorted(
            date.fromisoformat(str(row["date"]))
            for row in prices
            if row.get("date") is not None
        )
    except (KeyError, TypeError, ValueError):
        return False

    if not price_dates or end_date < start_date:
        return False

    business_days = 0
    cursor = start_date
    while cursor <= end_date:
        if cursor.weekday() < 5:
            business_days += 1
        cursor += timedelta(days=1)

    if business_days == 0:
        return True

    coverage_ratio = (
        len({value for value in price_dates if start_date <= value <= end_date})
        / business_days
    )
    return (
        coverage_ratio >= 0.75
        and price_dates[0] <= start_date
        and price_dates[-1] >= last_business_day_on_or_before(end_date)
    )


def last_business_day_on_or_before(value: date) -> date:
    cursor = value
    while cursor.weekday() >= 5:
        cursor -= timedelta(days=1)
    return cursor
