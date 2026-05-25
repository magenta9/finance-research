#!/usr/bin/env python3
"""Agent skill adapter for the canonical futures trend observation analyzer."""

from __future__ import annotations

import runpy
import sys
from pathlib import Path

STRATEGY_DIR = (
    Path(__file__).resolve().parents[4]
    / "tools"
    / "strategy"
    / "futures-trend-observation"
)
ANALYZE_SCRIPT = STRATEGY_DIR / "analyze.py"

sys.path.insert(0, str(STRATEGY_DIR))
runpy.run_path(str(ANALYZE_SCRIPT), run_name="__main__")
