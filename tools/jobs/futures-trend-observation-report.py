#!/usr/bin/env python3
"""Batch entrypoint for the futures trend observation report job."""

from __future__ import annotations

import runpy
import sys
from pathlib import Path

STRATEGY_DIR = (
    Path(__file__).resolve().parents[1] / "strategy" / "futures-trend-observation"
)
REPORT_SCRIPT = STRATEGY_DIR / "pi_agent_futures_trend_observation_report.py"

sys.path.insert(0, str(STRATEGY_DIR))
runpy.run_path(str(REPORT_SCRIPT), run_name="__main__")
