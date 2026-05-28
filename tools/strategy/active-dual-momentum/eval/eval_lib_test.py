import random
import tempfile
import unittest
from pathlib import Path

from eval_lib import (
    AssetCandidate,
    conflict_violations,
    create_run_dir,
    draw_valid_symbols,
    generate_cases,
    score_result,
    summarize_scores,
)


class EvalLibTest(unittest.TestCase):
    def test_conflict_violations_flags_groups_with_multiple_symbols(self):
        groups = {
            "treasury": ["T9999", "TL9999"],
            "metals": ["AU9999", "AG9999"],
        }

        self.assertEqual(
            conflict_violations(["T9999", "TL9999", "AU9999"], groups), ["treasury"]
        )
        self.assertEqual(conflict_violations(["T9999", "AU9999"], groups), [])

    def test_draw_valid_symbols_rejects_conflict_groups(self):
        selected = draw_valid_symbols(
            rng=random.Random(1),
            symbols=["AG9999", "AU9999", "IF9999", "RU9999"],
            basket_size=3,
            conflict_groups={"metals": ["AG9999", "AU9999"]},
        )

        self.assertEqual(len(selected), 3)
        self.assertLessEqual(len({"AG9999", "AU9999"}.intersection(selected)), 1)

    def test_generate_cases_is_deterministic(self):
        candidates = [
            AssetCandidate(f"id-{symbol}", symbol, symbol, "COMMODITY", "commodity")
            for symbol in ["AG9999", "AU9999", "IF9999", "RU9999", "SP9999"]
        ]
        first = generate_cases(
            candidates=candidates,
            basket_sizes=[3],
            windows_years=[1],
            samples_per_size=2,
            end_date="2026-05-27",
            conflict_groups={"metals": ["AG9999", "AU9999"]},
            seed=42,
        )
        second = generate_cases(
            candidates=candidates,
            basket_sizes=[3],
            windows_years=[1],
            samples_per_size=2,
            end_date="2026-05-27",
            conflict_groups={"metals": ["AG9999", "AU9999"]},
            seed=42,
        )

        self.assertEqual(first, second)
        self.assertEqual(len(first), 2)

    def test_score_result_uses_weighted_components(self):
        score = score_result(
            {"sharpeRatio": 0.25, "maxDrawdown": 0.175, "volatility": 0.175},
            {
                "sharpeWeight": 0.5,
                "maxDrawdownWeight": 0.3,
                "volatilityWeight": 0.2,
                "sharpeFloor": -0.5,
                "sharpeCeiling": 1.0,
                "maxDrawdownCeiling": 0.35,
                "volatilityCeiling": 0.35,
            },
        )

        self.assertEqual(score, 50.0)

    def test_summarize_scores_counts_failures(self):
        summary = summarize_scores(
            [
                {"status": "ok", "score": 20},
                {"status": "ok", "score": 80},
                {"status": "error", "error": "boom"},
            ]
        )

        self.assertEqual(summary["caseCount"], 3)
        self.assertEqual(summary["successCount"], 2)
        self.assertEqual(summary["failureCount"], 1)
        self.assertEqual(summary["meanScore"], 50.0)

    def test_create_run_dir_creates_dated_directory(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            run_dir = create_run_dir(Path(temp_dir), "unit")

            self.assertTrue(run_dir.exists())
            self.assertEqual(run_dir.name, "unit")


if __name__ == "__main__":
    unittest.main()
