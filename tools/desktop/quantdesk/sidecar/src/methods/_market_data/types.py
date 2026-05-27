from __future__ import annotations

from typing import TypedDict


class PriceRow(TypedDict):
    adjusted_close: float | None
    close: float | None
    date: str
    high: float | None
    low: float | None
    open: float | None
    source: str
    volume: float | None


class PriceFetchResult(TypedDict):
    attemptedSources: list[str]
    prices: list[PriceRow]
    symbol: str
    warnings: list[str]


class FxRateRow(TypedDict):
    date: str
    rate: float
    source: str


class FxFetchResult(TypedDict):
    attemptedSources: list[str]
    pair: str
    rates: list[FxRateRow]
    warnings: list[str]


class AssetSearchResult(TypedDict):
    assetClass: str
    currency: str
    market: str
    metadata: dict[str, object]
    name: str
    source: str
    symbol: str
