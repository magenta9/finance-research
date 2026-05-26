#!/usr/bin/env python3

from __future__ import annotations

import importlib.util
import sys
import unittest
from argparse import Namespace
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
ANALYZE_SCRIPT = SCRIPT_DIR / "analyze.py"
sys.path.insert(0, str(SCRIPT_DIR))

spec = importlib.util.spec_from_file_location("futures_trend_analyze", ANALYZE_SCRIPT)
assert spec and spec.loader
analyze_module = importlib.util.module_from_spec(spec)
sys.modules["futures_trend_analyze"] = analyze_module
spec.loader.exec_module(analyze_module)


def args() -> Namespace:
    return Namespace(
        asset_id="",
        end="2026-05-27",
        fixture_provider=False,
        lookback_days=3650,
        market="COMMODITY",
        quant_data="quant-data",
        quant_data_arg=[],
        quant_data_cwd=str(SCRIPT_DIR),
        start="2026-01-01",
        symbol="LH9999",
    )


class AnalyzeQuantDataBoundaryTest(unittest.TestCase):
    def test_malformed_maintenance_error_does_not_crash(self) -> None:
        original = analyze_module.run_quant_data

        try:
            analyze_module.run_quant_data = lambda *_args: {
                "ok": False,
                "maintenanceError": "bad",
            }
            result = analyze_module.analyze(args())
        finally:
            analyze_module.run_quant_data = original

        self.assertIn("QUANT_DATA_UNAVAILABLE", result["dataGaps"][0])

    def test_non_object_data_returns_unavailable(self) -> None:
        original = analyze_module.run_quant_data

        try:
            analyze_module.run_quant_data = lambda *_args: {"ok": True, "data": []}
            result = analyze_module.analyze(args())
        finally:
            analyze_module.run_quant_data = original

        self.assertEqual(result["overall"]["status"], "unavailable")
        self.assertIn("malformed price payload", result["dataGaps"][0])

    def test_non_array_prices_returns_unavailable(self) -> None:
        original = analyze_module.run_quant_data

        try:
            analyze_module.run_quant_data = lambda *_args: {
                "ok": True,
                "data": {"prices": {}},
            }
            result = analyze_module.analyze(args())
        finally:
            analyze_module.run_quant_data = original

        self.assertEqual(result["overall"]["status"], "unavailable")
        self.assertIn("malformed price rows", result["dataGaps"][0])


if __name__ == "__main__":
    unittest.main()