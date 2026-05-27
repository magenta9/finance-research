from __future__ import annotations

import asyncio
from pathlib import Path
import sys


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from methods.optimization import run_optimization


def test_python_optimizer_shape() -> None:
    result = asyncio.run(
        run_optimization(
            cov_matrix=[
                [0.04, 0.01, 0.0],
                [0.01, 0.03, 0.0],
                [0.0, 0.0, 0.02],
            ],
            mode="erc",
            constraints={"maxSingleWeight": 0.6},
        )
    )

    assert result["version"] == 2
    weights = result["weights"]
    assert abs(sum(weights) - 1.0) < 1e-6
    assert len(weights) == 3


def test_python_optimizer_respects_single_weight_cap() -> None:
    result = asyncio.run(
        run_optimization(
            cov_matrix=[
                [0.06, 0.01, 0.0, 0.0],
                [0.01, 0.03, 0.0, 0.0],
                [0.0, 0.0, 0.02, 0.0],
                [0.0, 0.0, 0.0, 0.01],
            ],
            mode="max_diversification",
            constraints={"maxSingleWeight": 0.35},
        )
    )

    assert result["version"] == 2
    weights = result["weights"]
    assert abs(sum(weights) - 1.0) < 1e-6
    assert max(weights) <= 0.350001
    assert len(weights) == 4
