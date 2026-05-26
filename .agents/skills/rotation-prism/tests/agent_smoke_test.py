#!/usr/bin/env python3
"""Agent smoke test for rotation-prism using pi -p."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


SKILL_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = SKILL_DIR.parents[2]
DEFAULT_TIMEOUT_SECONDS = 300


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run rotation-prism agent smoke via pi -p."
    )
    parser.add_argument("--pi", default="pi", help="pi executable path.")
    parser.add_argument("--workspace-dir", type=Path, default=PROJECT_ROOT)
    parser.add_argument("--skill-dir", type=Path, default=SKILL_DIR)
    parser.add_argument("--timeout-seconds", type=int, default=DEFAULT_TIMEOUT_SECONDS)
    parser.add_argument(
        "--prompt",
        default=(
            "/skill:rotation-prism\n\n"
            "比较中证红利跟红利低波。"
        ),
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    command = [
        args.pi,
        "--skill",
        str(args.skill_dir.expanduser().resolve()),
        "--no-session",
        "-p",
        args.prompt,
    ]
    try:
        completed = subprocess.run(
            command,
            cwd=args.workspace_dir.expanduser().resolve(),
            text=True,
            check=False,
            timeout=args.timeout_seconds,
        )
    except OSError as error:
        print(f"rotation-prism agent smoke could not start pi: {error}", file=sys.stderr)
        return 127
    except subprocess.TimeoutExpired:
        print(
            f"rotation-prism agent smoke timed out after {args.timeout_seconds}s",
            file=sys.stderr,
        )
        return 124
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
