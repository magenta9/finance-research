from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path
import sys


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from contracts import load_market_data_fixture
from methods.market_data import MarketDataMethods


def _assert_expected_subset(
    actual: Mapping[str, object], expected: Mapping[str, object]
) -> None:
    for key, value in expected.items():
        assert actual[key] == value


def test_price_merge_cases_match_shared_fixture() -> None:
    methods = MarketDataMethods()
    fixture = load_market_data_fixture("price-merge.json")

    for case in fixture["cases"]:
        result = methods._merge_price_row(
            case["existing"],
            case["incoming"],
            case["market"],
        )

        assert result["date"] == case["existing"]["date"]
        _assert_expected_subset(result, case["expected"])


def test_fx_merge_cases_match_shared_fixture() -> None:
    methods = MarketDataMethods()
    fixture = load_market_data_fixture("fx-merge.json")

    for case in fixture["cases"]:
        result = methods._merge_fx_row(case["existing"], case["incoming"])
        _assert_expected_subset(result, case["expected"])
