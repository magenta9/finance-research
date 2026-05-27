from __future__ import annotations

import asyncio
from pathlib import Path
import sys


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import server


def test_server_exposes_expected_rpc_surface() -> None:
    expected_methods = {
        "fetch_fundamentals",
        "fetch_flow_sentiment",
        "fetch_fx_rates",
        "fetch_market_source",
        "fetch_prices",
        "get_capabilities",
        "health_check",
        "run_optimization",
        "search_assets",
        "search_announcements",
        "search_news_catalysts",
        "shutdown",
    }

    assert expected_methods.issubset(server.METHODS)


def test_handle_rpc_runs_health_check_smoke() -> None:
    result = asyncio.run(server.handle_rpc({"id": 1, "method": "health_check"}))

    assert result == {
        "jsonrpc": "2.0",
        "id": 1,
        "result": {"status": "ok"},
    }
