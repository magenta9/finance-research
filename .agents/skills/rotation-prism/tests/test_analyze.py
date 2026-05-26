#!/usr/bin/env python3

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import unittest
from argparse import Namespace
from pathlib import Path


SKILL_DIR = Path(__file__).resolve().parents[1]
ANALYZE_SCRIPT = SKILL_DIR / "scripts" / "analyze.py"
EXAMPLE_INPUT = SKILL_DIR / "examples" / "growth-vs-value.input.json"

spec = importlib.util.spec_from_file_location("rotation_prism_analyze", ANALYZE_SCRIPT)
assert spec and spec.loader
analyze_module = importlib.util.module_from_spec(spec)
sys.modules["rotation_prism_analyze"] = analyze_module
spec.loader.exec_module(analyze_module)


def synthetic_rows(
    length: int, start: float, daily_step: float, date_offset: int = 0
) -> list[object]:
    rows = []
    value = start
    for index in range(length):
        value += daily_step
        rows.append(
            analyze_module.PricePoint(
                date=f"2025-01-{(index + date_offset) + 1:03d}", close=value
            )
        )
    return rows


class AnalyzeScriptTest(unittest.TestCase):
    def test_cli_reports_unavailable_when_quant_data_is_missing(self) -> None:
        example = json.loads(EXAMPLE_INPUT.read_text(encoding="utf-8"))
        completed = subprocess.run(
            [
                sys.executable,
                str(ANALYZE_SCRIPT),
                "--asset-a",
                example["asset_a"],
                "--asset-b",
                example["asset_b"],
                "--end",
                example["end"],
                "--quant-data",
                "/path/to/missing/quant-data",
            ],
            check=True,
            capture_output=True,
            text=True,
        )

        payload = json.loads(completed.stdout)

        self.assertEqual(payload["ratioDirection"], "asset_a/asset_b")
        self.assertEqual(payload["status"], "unavailable")
        self.assertEqual(payload["favor"], "neutral")
        self.assertEqual(payload["grade"], "unavailable")
        self.assertTrue(payload["nonExecution"])
        self.assertEqual(payload["dataGaps"][0]["code"], "quant_data_cli_missing")
        self.assertIn("make quant-data-install", payload["dataGaps"][0]["message"])

    def test_cli_reports_unavailable_for_invalid_end_date(self) -> None:
        completed = subprocess.run(
            [
                sys.executable,
                str(ANALYZE_SCRIPT),
                "--asset-a",
                "SPY",
                "--asset-b",
                "QQQ",
                "--end",
                "20260526",
                "--quant-data",
                "/path/to/missing/quant-data",
            ],
            check=True,
            capture_output=True,
            text=True,
        )

        payload = json.loads(completed.stdout)

        self.assertEqual(payload["status"], "unavailable")
        self.assertEqual(payload["dataGaps"][0]["code"], "invalid_input")

    def test_check_quant_data_rejects_incompatible_contract_version(self) -> None:
        original = analyze_module.subprocess.run

        def fake_run(
            *args: object, **kwargs: object
        ) -> subprocess.CompletedProcess[str]:
            return subprocess.CompletedProcess(
                args=[],
                returncode=0,
                stdout=json.dumps(
                    {
                        "contractVersion": "quant-data-cli.v0",
                        "methods": [
                            {"name": "search-assets"},
                            {"name": "get-price-series"},
                        ],
                    }
                ),
                stderr="",
            )

        try:
            analyze_module.subprocess.run = fake_run
            gaps = analyze_module.check_quant_data(
                Namespace(
                    quant_data="quant-data",
                    quant_data_arg=[],
                    quant_data_cwd=str(SKILL_DIR),
                    fixture_provider=False,
                )
            )
        finally:
            analyze_module.subprocess.run = original

        self.assertEqual(gaps[0]["code"], "quant_data_cli_incompatible")
        self.assertIn("contractVersion", gaps[0]["message"])

    def test_run_quant_data_rejects_non_object_json_envelope(self) -> None:
        original = analyze_module.subprocess.run

        def fake_run(*args: object, **kwargs: object) -> subprocess.CompletedProcess[str]:
            return subprocess.CompletedProcess(args=[], returncode=0, stdout="[]", stderr="")

        try:
            analyze_module.subprocess.run = fake_run
            with self.assertRaisesRegex(RuntimeError, "non-object JSON envelope"):
                analyze_module.run_quant_data(
                    Namespace(
                        quant_data="quant-data",
                        quant_data_arg=[],
                        quant_data_cwd=str(SKILL_DIR),
                        fixture_provider=False,
                    ),
                    "search-assets",
                    {"query": "SPY"},
                )
        finally:
            analyze_module.subprocess.run = original

    def test_resolve_asset_rejects_non_array_data(self) -> None:
        original = analyze_module.run_quant_data

        def fake_run_quant_data(
            args: object, method: str, payload: dict[str, object]
        ) -> dict[str, object]:
            return {"ok": True, "data": {"symbol": "SPY"}}

        try:
            analyze_module.run_quant_data = fake_run_quant_data
            asset, gaps = analyze_module.resolve_asset(object(), "SPY", "US")
        finally:
            analyze_module.run_quant_data = original

        self.assertIsNone(asset)
        self.assertEqual(gaps[0]["code"], "asset_search_invalid_response")

    def test_fetch_prices_rejects_non_object_data(self) -> None:
        original = analyze_module.run_quant_data

        def fake_run_quant_data(
            args: object, method: str, payload: dict[str, object]
        ) -> dict[str, object]:
            return {"ok": True, "data": []}

        try:
            analyze_module.run_quant_data = fake_run_quant_data
            rows, gaps = analyze_module.fetch_prices(
                object(), {"symbol": "SPY", "market": "US"}, "2026-05-01", "2026-05-02"
            )
        finally:
            analyze_module.run_quant_data = original

        self.assertEqual(rows, [])
        self.assertEqual(gaps[0]["code"], "price_fetch_invalid_response")

    def test_shift_days_requires_strict_iso_date(self) -> None:
        with self.assertRaises(ValueError):
            analyze_module.shift_days("20260526", -1)

    def test_analyze_price_points_produces_available_grade(self) -> None:
        params = analyze_module.Params(ma_period=20, return_diff_window=5, rsi_period=5)
        rows_a = synthetic_rows(80, start=100, daily_step=1.0)
        rows_b = synthetic_rows(80, start=100, daily_step=0.1)

        payload = analyze_module.analyze_price_points(
            asset_a={"symbol": "A", "name": "Asset A", "market": "TEST"},
            asset_b={"symbol": "B", "name": "Asset B", "market": "TEST"},
            rows_a=rows_a,
            rows_b=rows_b,
            params=params,
        )

        self.assertEqual(payload["status"], "available")
        self.assertEqual(payload["favor"], "asset_a")
        self.assertIn(payload["grade"], {"A", "B"})
        self.assertTrue(payload["trendEvidence"])
        self.assertEqual(payload["dataGaps"], [])

    def test_date_alignment_partial_with_shared_dates(self) -> None:
        params = analyze_module.Params(ma_period=20, return_diff_window=5, rsi_period=5)
        rows_a = synthetic_rows(80, start=100, daily_step=1.0)
        rows_b = synthetic_rows(79, start=100, daily_step=1.0)

        payload = analyze_module.analyze_price_points(
            asset_a={"symbol": "A"},
            asset_b={"symbol": "B"},
            rows_a=rows_a,
            rows_b=rows_b,
            params=params,
        )

        # 有 79 天交集，继续分析，仅返回 partial warning
        self.assertEqual(payload["status"], "available")
        self.assertEqual(payload["dataGaps"][0]["code"], "date_alignment_partial")

    def test_date_alignment_mismatch_no_shared_dates(self) -> None:
        params = analyze_module.Params(ma_period=20, return_diff_window=5, rsi_period=5)
        rows_a = synthetic_rows(80, start=100, daily_step=1.0)
        # rows_b 完全错开，无任何交集（偏移 80 天，两序列恰好无重叠）
        rows_b = synthetic_rows(80, start=100, daily_step=1.0, date_offset=80)

        payload = analyze_module.analyze_price_points(
            asset_a={"symbol": "A"},
            asset_b={"symbol": "B"},
            rows_a=rows_a,
            rows_b=rows_b,
            params=params,
        )

        self.assertEqual(payload["status"], "unavailable")
        self.assertEqual(payload["dataGaps"][0]["code"], "date_alignment_mismatch")

    def test_identical_assets_are_neutral(self) -> None:
        params = analyze_module.Params(ma_period=20, return_diff_window=5, rsi_period=5)
        rows = synthetic_rows(80, start=100, daily_step=1.0)

        payload = analyze_module.analyze_price_points(
            asset_a={"symbol": "A"},
            asset_b={"symbol": "A"},
            rows_a=rows,
            rows_b=rows,
            params=params,
        )

        self.assertEqual(payload["status"], "available")
        self.assertEqual(payload["favor"], "neutral")
        self.assertEqual(payload["grade"], "unavailable")
        self.assertEqual(payload["trendEvidence"], [])
        self.assertEqual(payload["meanReversionEvidence"], [])

    def test_resolve_asset_reports_ambiguous_candidates(self) -> None:
        original = analyze_module.run_quant_data

        def fake_run_quant_data(
            args: object, method: str, payload: dict[str, object]
        ) -> dict[str, object]:
            self.assertEqual(method, "search-assets")
            return {
                "ok": True,
                "data": [
                    {"symbol": "000922", "name": "中证红利", "market": "A"},
                    {"symbol": "932315", "name": "中证红利质量", "market": "A"},
                ],
            }

        try:
            analyze_module.run_quant_data = fake_run_quant_data
            asset, gaps = analyze_module.resolve_asset(object(), "中证红利", "A")
        finally:
            analyze_module.run_quant_data = original

        self.assertIsNone(asset)
        self.assertEqual(gaps[0]["code"], "asset_ambiguous")

    def test_normalize_price_rows_uses_calculation_close_only(self) -> None:
        rows = [
            {
                "date": "2026-05-01",
                "calculationClose": 10.0,
                "adjustedClose": 9.0,
                "close": 8.0,
            },
            {"date": "2026-05-02", "adjustedClose": 9.0, "close": 8.0},
        ]

        points = analyze_module.normalize_price_rows(rows)

        self.assertEqual(len(points), 1)
        self.assertEqual(points[0].close, 10.0)


if __name__ == "__main__":
    unittest.main()
