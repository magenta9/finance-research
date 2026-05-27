from __future__ import annotations

import asyncio
import os
from typing import Iterable

try:
    import numpy as np
except Exception:
    np = None

try:
    from scipy.optimize import minimize
except Exception:
    minimize = None


def _normalize(weights: list[float]) -> list[float]:
    total = sum(weights)
    if abs(total) < 1e-9:
        return [1 / len(weights) for _ in weights]
    return [value / total for value in weights]


def _project(weights: list[float], max_single_weight: float) -> list[float]:
    clipped = [min(max(value, 0.0), max_single_weight) for value in weights]
    return _normalize(clipped)


def _portfolio_volatility(
    weights: Iterable[float], covariance: list[list[float]]
) -> float:
    variance = 0.0
    weight_list = list(weights)
    for row_index, row in enumerate(covariance):
        for column_index, value in enumerate(row):
            variance += weight_list[row_index] * value * weight_list[column_index]
    return max(variance, 0.0) ** 0.5


def _compute_risk_contributions(
    weights: list[float], covariance: list[list[float]]
) -> list[float]:
    n = len(weights)
    cov_times_w = []
    for row in covariance:
        cov_times_w.append(sum(row[j] * weights[j] for j in range(n)))
    variance = sum(weights[i] * cov_times_w[i] for i in range(n))
    if abs(variance) < 1e-15:
        return [0.0] * n
    return [(weights[i] * cov_times_w[i]) / variance for i in range(n)]


def _compute_diversification_ratio(
    weights: list[float],
    covariance: list[list[float]],
    volatilities: list[float],
) -> float:
    weighted_vol_sum = sum(w * v for w, v in zip(weights, volatilities))
    port_vol = _portfolio_volatility(weights, covariance)
    if port_vol < 1e-12:
        return 1.0
    return weighted_vol_sum / port_vol


def build_class_constraints(
    asset_classes: list[str] | None,
    max_class_weight: dict[str, float] | None,
    asset_count: int,
) -> list[dict]:
    """Build SLSQP inequality constraints for per-class weight caps."""
    if not asset_classes or not max_class_weight:
        return []

    constraints = []
    unique_classes = set(asset_classes)
    for cls in unique_classes:
        cap = max_class_weight.get(cls)
        if cap is None:
            continue
        indices = [i for i, ac in enumerate(asset_classes) if ac == cls]
        if not indices:
            continue

        def make_fn(idx_list: list[int], cap_val: float):
            return lambda w: cap_val - sum(w[i] for i in idx_list)

        constraints.append(
            {
                "type": "ineq",
                "fun": make_fn(indices, cap),
            }
        )

    return constraints


def _solve_heuristic(
    volatilities: list[float],
    covariance: list[list[float]],
    mode: str,
    constraints: dict[str, object],
) -> dict[str, object]:
    max_single_weight = float(constraints.get("maxSingleWeight", 1.0))
    asset_count = len(volatilities)
    if asset_count == 0:
        return {
            "version": 2,
            "weights": [],
            "diagnostics": {
                "optimizer": "python",
                "alignedDates": 0,
                "excludedAssets": [],
                "warnings": [],
                "fallbackUsed": False,
            },
        }

    if mode == "erc" or mode == "inverse_volatility":
        raw = [1 / max(v, 1e-8) for v in volatilities]
        weights = _project(raw, max_single_weight)
        return {
            "version": 2,
            "weights": weights,
            "diagnostics": {
                "optimizer": "python",
                "alignedDates": 0,
                "excludedAssets": [],
                "warnings": ["Used heuristic fallback."],
                "fallbackUsed": True,
                "fallbackReason": "erc_non_converged" if mode == "erc" else None,
                "fallbackEquivalentMode": "inverse_volatility",
            },
        }

    if mode == "max_diversification":
        weights = [1 / asset_count for _ in range(asset_count)]
        weights = _project(weights, max_single_weight)
        dr = _compute_diversification_ratio(weights, covariance, volatilities)
        return {
            "version": 2,
            "weights": weights,
            "diversificationRatio": dr,
            "diagnostics": {
                "optimizer": "python",
                "alignedDates": 0,
                "excludedAssets": [],
                "warnings": ["Used heuristic fallback."],
                "fallbackUsed": True,
                "fallbackReason": "singular_matrix",
                "fallbackEquivalentMode": "equal_weight",
            },
        }

    # Unknown mode fallback
    weights = [1 / asset_count for _ in range(asset_count)]
    return {
        "version": 2,
        "weights": _project(weights, max_single_weight),
        "diagnostics": {
            "optimizer": "python",
            "alignedDates": 0,
            "excludedAssets": [],
            "warnings": [f"Unknown mode: {mode}"],
            "fallbackUsed": True,
        },
    }


def _solve_scipy(
    volatilities: list[float],
    covariance: list[list[float]],
    mode: str,
    constraints: dict[str, object],
    asset_classes: list[str] | None = None,
) -> dict[str, object]:
    if np is None or minimize is None:
        return _solve_heuristic(volatilities, covariance, mode, constraints)

    asset_count = len(volatilities)
    max_single_weight = float(constraints.get("maxSingleWeight", 1.0))
    max_class_weight_raw = constraints.get("maxClassWeight")
    max_class_weight = (
        dict(max_class_weight_raw) if isinstance(max_class_weight_raw, dict) else None
    )
    covariance_matrix = np.array(covariance)
    vol_vector = np.array(volatilities)

    initial = np.array([1 / asset_count for _ in range(asset_count)])
    bounds = [(0.0, max_single_weight) for _ in range(asset_count)]
    equality_constraints = [{"type": "eq", "fun": lambda weights: weights.sum() - 1.0}]
    class_constraints = build_class_constraints(
        asset_classes, max_class_weight, asset_count
    )
    all_constraints = equality_constraints + class_constraints

    if mode == "inverse_volatility":
        raw = np.array([1 / max(v, 1e-8) for v in volatilities])
        raw = raw / raw.sum()
        raw = np.clip(raw, 0.0, max_single_weight)
        weights = _normalize(raw.tolist())
        return {
            "version": 2,
            "weights": weights,
            "diagnostics": {
                "optimizer": "python",
                "alignedDates": 0,
                "excludedAssets": [],
                "warnings": [],
                "fallbackUsed": False,
            },
        }

    if mode == "erc":

        def erc_objective(weights: np.ndarray) -> float:
            marginal = covariance_matrix @ weights
            variance = float(weights @ marginal)
            risk_contributions = weights * marginal / max(variance, 1e-9)
            return float(((risk_contributions - 1 / asset_count) ** 2).sum())

        result = minimize(
            erc_objective,
            initial,
            bounds=bounds,
            constraints=all_constraints,
            method="SLSQP",
        )

        if not result.success:
            return _solve_heuristic(volatilities, covariance, mode, constraints)

        weights = _normalize(result.x.tolist())
        contributions = _compute_risk_contributions(weights, covariance)
        gap = max(contributions) - min(contributions)
        converged = gap < 1e-4

        return {
            "version": 2,
            "weights": weights,
            "diagnostics": {
                "optimizer": "python",
                "alignedDates": 0,
                "excludedAssets": [],
                "warnings": [] if converged else ["ERC may not have fully converged."],
                "fallbackUsed": not converged,
                "fallbackReason": None if converged else "erc_non_converged",
                "erc": {
                    "converged": converged,
                    "iterations": int(result.nit) if hasattr(result, "nit") else 0,
                    "maxContributionGap": gap,
                    "convergenceWarning": not converged,
                },
            },
        }

    if mode == "max_diversification":

        def mdp_objective(weights: np.ndarray) -> float:
            weighted_vol = float(weights @ vol_vector)
            port_vol = float(np.sqrt(max(weights @ covariance_matrix @ weights, 0)))
            if port_vol < 1e-12:
                return 0.0
            return -(weighted_vol / port_vol)

        result = minimize(
            mdp_objective,
            initial,
            bounds=bounds,
            constraints=all_constraints,
            method="SLSQP",
        )

        if not result.success:
            # Try with regularization
            regularized_cov = (
                covariance_matrix
                + np.eye(asset_count) * np.max(np.diag(covariance_matrix)) * 0.01
            )

            def mdp_reg_objective(weights: np.ndarray) -> float:
                weighted_vol = float(weights @ vol_vector)
                port_vol = float(np.sqrt(max(weights @ regularized_cov @ weights, 0)))
                if port_vol < 1e-12:
                    return 0.0
                return -(weighted_vol / port_vol)

            result = minimize(
                mdp_reg_objective,
                initial,
                bounds=bounds,
                constraints=all_constraints,
                method="SLSQP",
            )

            if not result.success:
                return _solve_heuristic(volatilities, covariance, mode, constraints)

        weights = _normalize(result.x.tolist())
        dr = _compute_diversification_ratio(weights, covariance, volatilities)

        return {
            "version": 2,
            "weights": weights,
            "diversificationRatio": dr,
            "diagnostics": {
                "optimizer": "python",
                "alignedDates": 0,
                "excludedAssets": [],
                "warnings": [],
                "fallbackUsed": False,
            },
        }

    return _solve_heuristic(volatilities, covariance, mode, constraints)


async def run_optimization(
    cov_matrix: list[list[float]],
    mode: str,
    constraints: dict[str, object],
    volatilities: list[float] | None = None,
    asset_classes: list[str] | None = None,
    # Legacy parameter - ignored but accepted for backward compat
    mean_returns: list[float] | None = None,
) -> dict[str, object]:
    # Reject unsupported constraints
    if constraints.get("allowShort"):
        return {
            "version": 2,
            "weights": [],
            "diagnostics": {
                "optimizer": "python",
                "alignedDates": 0,
                "excludedAssets": [],
                "warnings": ["Short selling is not supported."],
                "fallbackUsed": False,
                "fallbackReason": "unsupported_constraints",
            },
        }
    if constraints.get("allowLeverage"):
        return {
            "version": 2,
            "weights": [],
            "diagnostics": {
                "optimizer": "python",
                "alignedDates": 0,
                "excludedAssets": [],
                "warnings": ["Leverage is not supported."],
                "fallbackUsed": False,
                "fallbackReason": "unsupported_constraints",
            },
        }

    # Derive volatilities from covariance diagonal if not provided
    if volatilities is None:
        n = len(cov_matrix)
        volatilities = [max(cov_matrix[i][i], 0) ** 0.5 * (252**0.5) for i in range(n)]

    if os.environ.get("QUANTDESK_E2E_ALLOCATION_PROBE") == "1":
        return _solve_heuristic(volatilities, cov_matrix, mode, constraints)

    return await asyncio.to_thread(
        _solve_scipy, volatilities, cov_matrix, mode, constraints, asset_classes
    )
