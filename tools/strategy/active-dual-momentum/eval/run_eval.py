#!/usr/bin/env python3
"""Deprecated wrapper. Use run_strategy_eval.py with config/adm-eval-run.json."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


EVAL_ROOT = Path(__file__).resolve().parents[2] / "eval"
ADM_CONFIG = EVAL_ROOT / "config/adm-eval-run.json"


def main() -> int:
    target = EVAL_ROOT / "run_strategy_eval.py"
    sys.stderr.write(
        "active-dual-momentum eval/run_eval.py is deprecated; "
        "use tools/strategy/eval/run_strategy_eval.py --config config/adm-eval-run.json instead.\n"
    )
    command = [sys.executable, str(target), "--config", str(ADM_CONFIG), *sys.argv[1:]]
    return subprocess.call(command)


if __name__ == "__main__":
    raise SystemExit(main())
