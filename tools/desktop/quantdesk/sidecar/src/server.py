from __future__ import annotations

import asyncio
import json
import os
import signal
import sys
import time
import traceback
from typing import Any, Awaitable, Callable

from websockets.asyncio.server import serve

from methods.health import get_capabilities, health_check
from methods.flow_sentiment import FlowSentimentMethods
from methods.fundamentals import FundamentalsMethods
from methods.market_data import MarketDataMethods
from methods.news_catalysts import NewsCatalystMethods
from methods.optimization import run_optimization


MethodHandler = Callable[..., Awaitable[Any]]


market_data_methods = MarketDataMethods()
news_catalyst_methods = NewsCatalystMethods()
fundamentals_methods = FundamentalsMethods()
flow_sentiment_methods = FlowSentimentMethods()
shutdown_event = asyncio.Event()
active_websockets: set[Any] = set()


def log(level: str, message: str, **metadata: Any) -> None:
    payload: dict[str, Any] = {
        "level": level,
        "message": message,
        "pid": os.getpid(),
        **metadata,
    }

    if level in ("error", "fatal"):
        exc_info = sys.exc_info()
        if exc_info[2] is not None:
            payload["traceback"] = traceback.format_exception(*exc_info)

    sys.stderr.write(json.dumps(payload, ensure_ascii=False, default=str) + "\n")
    sys.stderr.flush()


async def shutdown() -> dict[str, str]:
    shutdown_event.set()
    return {"status": "shutting_down"}


METHODS: dict[str, MethodHandler] = {
    "fetch_fx_rates": market_data_methods.fetch_fx_rates,
    "fetch_flow_sentiment": flow_sentiment_methods.fetch_flow_sentiment,
    "fetch_fundamentals": fundamentals_methods.fetch_fundamentals,
    "fetch_market_source": news_catalyst_methods.fetch_market_source,
    "fetch_prices": market_data_methods.fetch_prices,
    "get_capabilities": get_capabilities,
    "health_check": health_check,
    "run_optimization": run_optimization,
    "search_assets": market_data_methods.search_assets,
    "search_announcements": news_catalyst_methods.search_announcements,
    "search_news_catalysts": news_catalyst_methods.search_news_catalysts,
    "shutdown": shutdown,
}


async def handle_rpc(payload: dict[str, Any]) -> dict[str, Any]:
    method_name = payload.get("method")
    params = payload.get("params") or {}
    request_id = payload.get("id")
    start = time.monotonic()

    if method_name not in METHODS:
        log("warn", "method_not_found", method=method_name)
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "error": {"code": -32601, "message": f"Method {method_name} not found."},
        }

    try:
        result = await METHODS[method_name](**params)
        elapsed_ms = round((time.monotonic() - start) * 1000, 1)
        if elapsed_ms > 1000:
            log("warn", "slow_rpc", method=method_name, elapsed_ms=elapsed_ms)
        return {"jsonrpc": "2.0", "id": request_id, "result": result}
    except Exception as error:
        elapsed_ms = round((time.monotonic() - start) * 1000, 1)
        log(
            "error",
            "rpc_error",
            method=method_name,
            detail=str(error),
            elapsed_ms=elapsed_ms,
        )
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "error": {
                "code": -32000,
                "message": str(error),
                "data": {"method": method_name},
            },
        }


async def websocket_handler(websocket) -> None:
    active_websockets.add(websocket)
    try:
        async for raw_message in websocket:
            payload = json.loads(raw_message)
            response = await handle_rpc(payload)
            if payload.get("id") is not None:
                await websocket.send(json.dumps(response))
    finally:
        active_websockets.discard(websocket)


async def close_active_websockets() -> None:
    if not active_websockets:
        return

    await asyncio.gather(
        *[
            websocket.close(code=1001, reason="sidecar shutdown")
            for websocket in list(active_websockets)
        ],
        return_exceptions=True,
    )


async def main() -> None:
    loop = asyncio.get_running_loop()

    for signame in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(signame, shutdown_event.set)

    server = await serve(websocket_handler, "127.0.0.1", 0)
    try:
        port = server.sockets[0].getsockname()[1]
        log("info", "sidecar_started", port=port, python=sys.version)
        sys.stdout.write(json.dumps({"ready": True, "port": port}) + "\n")
        sys.stdout.flush()
        await shutdown_event.wait()
    finally:
        log("info", "sidecar_shutting_down")
        await close_active_websockets()
        server.close()
        await server.wait_closed()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as error:
        log("fatal", "sidecar_failed", detail=str(error))
        raise
