import random
import unittest

from eval_core.cases import (
    case_id,
    draw_unique_symbols,
    generate_unique_basket_cases,
    start_date_for_window,
)
from eval_core.contract import scoring_profile_from_dict
from eval_core.scoring import score_result, summarize_by_strategy, summarize_scores


class EvalCoreScoringTest(unittest.TestCase):
    def test_score_result_uses_profile_weights(self):
        profile = scoring_profile_from_dict(
            {
                "metrics": [
                    {
                        "key": "sharpeRatio",
                        "weight": 0.5,
                        "direction": "higher_better",
                        "floor": -0.5,
                        "ceiling": 1.0,
                    },
                    {
                        "key": "maxDrawdown",
                        "weight": 0.3,
                        "direction": "lower_better",
                        "ceiling": 0.35,
                    },
                    {
                        "key": "volatility",
                        "weight": 0.2,
                        "direction": "lower_better",
                        "ceiling": 0.35,
                    },
                ]
            }
        )
        score = score_result(
            {"sharpeRatio": 0.25, "maxDrawdown": 0.175, "volatility": 0.175},
            profile,
        )
        self.assertEqual(score, 50.0)

    def test_summarize_scores_marks_incomparable_when_required(self):
        profile = scoring_profile_from_dict(
            {
                "requireAllCasesSucceeded": True,
                "metrics": [
                    {
                        "key": "sharpeRatio",
                        "weight": 1,
                        "direction": "higher_better",
                        "floor": 0,
                        "ceiling": 1,
                    }
                ],
            }
        )
        summary = summarize_scores(
            [
                {"status": "ok", "score": 20},
                {"status": "error", "error": "boom"},
            ],
            profile,
        )
        self.assertFalse(summary["scoreComparable"])
        self.assertIsNone(summary["finalScore"])

    def test_summarize_by_strategy_builds_leaderboard(self):
        profile = scoring_profile_from_dict(
            {
                "requireAllCasesSucceeded": False,
                "metrics": [
                    {
                        "key": "sharpeRatio",
                        "weight": 1,
                        "direction": "higher_better",
                        "floor": 0,
                        "ceiling": 1,
                    }
                ],
            }
        )
        summary = summarize_by_strategy(
            [
                {"status": "ok", "score": 80, "strategyId": "erc"},
                {"status": "ok", "score": 60, "strategyId": "inverse_volatility"},
            ],
            profile,
        )
        self.assertEqual(summary["leaderboard"][0]["strategyId"], "erc")


class EvalCoreCasesTest(unittest.TestCase):
    def test_draw_unique_symbols_is_deterministic(self):
        symbols = ["AAA", "BBB", "CCC", "DDD", "EEE"]
        first = draw_unique_symbols(
            basket_size=3,
            rng=random.Random(7),
            seen=set(),
            symbols=symbols,
        )
        second = draw_unique_symbols(
            basket_size=3,
            rng=random.Random(7),
            seen=set(),
            symbols=symbols,
        )
        self.assertEqual(first, second)

    def test_generate_unique_basket_cases_respects_limit(self):
        assets = [{"symbol": f"S{i}", "id": f"id-{i}"} for i in range(6)]
        cases = generate_unique_basket_cases(
            assets=assets,
            basket_sizes=[3],
            cadences=["monthly"],
            end_date="2026-05-27",
            limit=2,
            samples_per_cell=5,
            seed=11,
            windows_years=[1],
        )
        self.assertEqual(len(cases), 2)
        self.assertEqual(cases[0].case_id, case_id(cases[0].symbols, 1, 0, cadence="monthly"))

    def test_start_date_for_window(self):
        self.assertEqual(start_date_for_window("2026-05-27", 2), "2024-05-27")


if __name__ == "__main__":
    unittest.main()
