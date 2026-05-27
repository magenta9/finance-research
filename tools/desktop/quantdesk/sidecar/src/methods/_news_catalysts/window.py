from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any


def parse_date(value: str | None) -> date | None:
    if not value:
        return None

    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
    except ValueError:
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            return None


def today_utc() -> date:
    return datetime.now(timezone.utc).date()


def evaluate_catalyst_window(
    events: list[dict[str, Any]],
    *,
    lookahead_days: int,
    lookback_days: int,
    provider_status: str,
    reference_date: str | None = None,
) -> dict[str, Any]:
    reference = parse_date(reference_date) or today_utc()
    start = reference - timedelta(days=lookback_days)
    end = reference + timedelta(days=lookahead_days)

    window = {
        "referenceDate": reference.isoformat(),
        "startDate": start.isoformat(),
        "endDate": end.isoformat(),
        "lookbackDays": lookback_days,
        "lookaheadDays": lookahead_days,
    }

    if provider_status == "unavailable":
        return {"inCatalystWindow": "unknown", "window": window}

    for event in events:
        published_at = parse_date(event.get("publishedAt"))
        event_date = parse_date(event.get("eventDate"))

        if published_at is not None and start <= published_at <= reference:
            return {"inCatalystWindow": True, "window": window}

        if (
            published_at is not None
            and published_at <= reference
            and event_date is not None
            and reference < event_date <= end
        ):
            return {"inCatalystWindow": True, "window": window}

    return {"inCatalystWindow": False, "window": window}
