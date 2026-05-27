from __future__ import annotations


async def health_check() -> dict[str, str]:
    return {"status": "ok"}


async def get_capabilities() -> dict[str, object]:
    return {
        "methods": [
            "health_check",
            "get_capabilities",
            "search_news_catalysts",
            "search_announcements",
            "fetch_market_source",
            "search_assets",
            "fetch_prices",
            "fetch_fx_rates",
            "run_optimization",
            "shutdown",
        ]
    }
