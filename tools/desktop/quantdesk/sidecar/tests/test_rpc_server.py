from __future__ import annotations

import asyncio
import json
from pathlib import Path
import sys


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import server


def test_handle_rpc_returns_method_not_found_error() -> None:
    result = asyncio.run(server.handle_rpc({"id": 1, "method": "missing_method"}))

    assert result["error"]["code"] == -32601
    assert "not found" in result["error"]["message"]


def test_error_log_includes_traceback(capsys) -> None:
    try:
        raise RuntimeError("boom")
    except RuntimeError:
        server.log("error", "rpc_error", detail="boom")

    captured = capsys.readouterr()
    payload = json.loads(captured.err.strip())

    assert payload["message"] == "rpc_error"
    assert payload["detail"] == "boom"
    assert payload["pid"] > 0
    assert payload["traceback"]
