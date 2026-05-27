#!/usr/bin/env python3

from __future__ import annotations

import argparse
import subprocess
import sys
import unittest
from pathlib import Path


SKILL_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = SKILL_DIR.parents[2]
DEFAULT_TIMEOUT_SECONDS = 300
EXPECTED_SECTION_HEADINGS = [
    "## 一句话结论",
    "## 标的与数据",
    "## 趋势证据",
    "## 均值回复证据",
    "## 信号等级",
    "## 数据缺口",
    "## 边界声明",
]


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
            "比较中证红利跟红利低波。\n"
            "最终回答只输出中文 Markdown 报告，并严格按顺序保留这七个二级标题：\n"
            "## 一句话结论\n"
            "## 标的与数据\n"
            "## 趋势证据\n"
            "## 均值回复证据\n"
            "## 信号等级\n"
            "## 数据缺口\n"
            "## 边界声明\n"
            "即使某一节没有内容，也必须保留标题并明确写“无”。"
        ),
    )
    return parser.parse_args()


def extract_section_headings(output: str) -> list[str]:
    return [
        line.strip() for line in output.splitlines() if line.strip().startswith("## ")
    ]


def validate_report_contract(output: str) -> None:
    headings = extract_section_headings(output)
    if headings != EXPECTED_SECTION_HEADINGS:
        raise ValueError(
            "rotation-prism smoke output must contain exactly the seven required sections "
            f"in order: {EXPECTED_SECTION_HEADINGS}; got {headings}"
        )


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
            capture_output=True,
            text=True,
            check=False,
            timeout=args.timeout_seconds,
        )
    except OSError as error:
        print(
            f"rotation-prism agent smoke could not start pi: {error}", file=sys.stderr
        )
        return 127
    except subprocess.TimeoutExpired:
        print(
            f"rotation-prism agent smoke timed out after {args.timeout_seconds}s",
            file=sys.stderr,
        )
        return 124
    if completed.stdout:
        sys.stdout.write(completed.stdout)
    if completed.stderr:
        sys.stderr.write(completed.stderr)
    if completed.returncode != 0:
        return completed.returncode
    try:
        validate_report_contract(completed.stdout)
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 1
    return completed.returncode


class AgentSmokeContractTest(unittest.TestCase):
    def test_validate_report_contract_accepts_expected_sections(self) -> None:
        output = "\n".join(
            [
                "## 一句话结论",
                "内容",
                "## 标的与数据",
                "内容",
                "## 趋势证据",
                "内容",
                "## 均值回复证据",
                "内容",
                "## 信号等级",
                "内容",
                "## 数据缺口",
                "内容",
                "## 边界声明",
                "内容",
            ]
        )

        validate_report_contract(output)

    def test_validate_report_contract_rejects_missing_section(self) -> None:
        output = "\n".join(
            [
                "## 一句话结论",
                "## 标的与数据",
                "## 趋势证据",
                "## 信号等级",
                "## 数据缺口",
                "## 边界声明",
            ]
        )

        with self.assertRaisesRegex(ValueError, "seven required sections"):
            validate_report_contract(output)


if __name__ == "__main__":
    raise SystemExit(main())
