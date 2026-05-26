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
        quant_data_timeout_seconds=30,
        start="2026-01-01",
        symbol="LH9999",
    )


class AnalyzeQuantDataBoundaryTest(unittest.TestCase):
    def test_invalid_quant_data_timeout_returns_unavailable(self) -> None:
        test_args = args()
        test_args.quant_data_timeout_seconds = 0

        result = analyze_module.analyze(test_args)

        self.assertEqual(result["overall"]["status"], "unavailable")
        self.assertIn("quant-data-timeout-seconds", result["dataGaps"][0])

    def test_run_quant_data_reports_timeout(self) -> None:
        original = analyze_module.subprocess.run

        def fake_run(*_args: object, **kwargs: object) -> object:
            self.assertEqual(kwargs.get("timeout"), 9)
            raise analyze_module.subprocess.TimeoutExpired(
                cmd="quant-data", timeout=9
            )

        test_args = args()
        test_args.quant_data_timeout_seconds = 9
        try:
            analyze_module.subprocess.run = fake_run
            with self.assertRaisesRegex(RuntimeError, "timed out after 9s"):
                analyze_module.run_quant_data(test_args, {"symbol": "LH9999"})
        finally:
            analyze_module.subprocess.run = original

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