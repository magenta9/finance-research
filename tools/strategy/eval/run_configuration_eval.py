#!/usr/bin/env python3
"""Deprecated wrapper. Use run_strategy_eval.py instead."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def main() -> int:
    target = Path(__file__).with_name("run_strategy_eval.py")
    sys.stderr.write(
        "run_configuration_eval.py is deprecated; use run_strategy_eval.py instead.\n"
    )
    command = [sys.executable, str(target), *sys.argv[1:]]
    return subprocess.call(command)


if __name__ == "__main__":
    raise SystemExit(main())
