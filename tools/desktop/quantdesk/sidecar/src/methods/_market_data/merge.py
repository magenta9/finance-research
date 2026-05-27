from __future__ import annotations

from typing import Any

from .policy import source_priority


PRICE_COMPLETENESS_FIELDS = ("open", "high", "low", "close", "adjusted_close")


def price_completeness(row: dict[str, Any]) -> int:
    return sum(1 for field in PRICE_COMPLETENESS_FIELDS if row.get(field) is not None)


def is_filled_by(existing: dict[str, Any], incoming: dict[str, Any]) -> bool:
    return any(
        existing.get(field) is None and incoming.get(field) is not None
        for field in PRICE_COMPLETENESS_FIELDS
    )


def merge_price_row(
    policy: dict[str, Any],
    existing: dict[str, Any] | None,
    incoming: dict[str, Any],
    market: str | None,
) -> dict[str, Any]:
    if existing is None:
        return incoming

    existing_priority = source_priority(
        policy,
        str(existing.get("source", "")),
        market=market,
        kind="price",
    )
    incoming_priority = source_priority(
        policy,
        str(incoming.get("source", "")),
        market=market,
        kind="price",
    )

    if incoming_priority > existing_priority:
        return incoming
    if incoming_priority < existing_priority:
        return existing

    if existing.get("source") == incoming.get("source"):
        return {
            **existing,
            **{key: value for key, value in incoming.items() if value is not None},
        }

    existing_completeness = price_completeness(existing)
    incoming_completeness = price_completeness(incoming)

    if incoming_completeness > existing_completeness:
        return incoming
    if incoming_completeness < existing_completeness and not is_filled_by(
        existing, incoming
    ):
        return existing

    if is_filled_by(existing, incoming):
        merged = {
            **existing,
            **{
                key: value
                for key, value in incoming.items()
                if value is not None and existing.get(key) is None
            },
        }
        merged["source"] = existing.get("source")
        return merged

    return existing


def merge_fx_row(
    policy: dict[str, Any], existing: dict[str, Any] | None, incoming: dict[str, Any]
) -> dict[str, Any]:
    if existing is None:
        return incoming

    existing_priority = source_priority(
        policy,
        str(existing.get("source", "")),
        market=None,
        kind="fx",
    )
    incoming_priority = source_priority(
        policy,
        str(incoming.get("source", "")),
        market=None,
        kind="fx",
    )

    if incoming_priority > existing_priority:
        return incoming
    if incoming_priority < existing_priority:
        return existing
    if existing.get("source") == incoming.get("source"):
        return incoming
    return existing
