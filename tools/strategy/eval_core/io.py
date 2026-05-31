from __future__ import annotations

import json
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)
        file.write("\n")


def create_run_dir(output_root: Path, run_id: str | None = None) -> Path:
    today = datetime.now().strftime("%Y-%m-%d")
    resolved_run_id = run_id or datetime.now().strftime("%H%M%S")
    run_dir = output_root / today / resolved_run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    return run_dir


def parse_csv_list(value: str) -> list[str]:
    parsed = [item.strip() for item in value.split(",") if item.strip()]
    if not parsed:
        raise ValueError("Expected at least one value.")
    return parsed


def parse_int_list(value: str) -> list[int]:
    return [int(item) for item in parse_csv_list(value)]


def join_values(values: list[Any]) -> str:
    return ",".join(str(value) for value in values)


def call_quant_data(
    quant_data_bin: str,
    method: str,
    payload: dict[str, Any],
    *,
    json_flag: bool = False,
) -> dict[str, Any]:
    command = [quant_data_bin, method]
    if json_flag:
        command.append("--json")
    process = subprocess.run(
        command,
        input=json.dumps(payload, ensure_ascii=False) if payload else None,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if process.returncode != 0:
        sys.stderr.write(process.stderr)
        raise RuntimeError(
            f"quant-data {method} failed with exit code {process.returncode}."
        )
    if process.stderr.strip():
        sys.stderr.write(process.stderr)
    return json.loads(process.stdout)


def validate_eval_runtime(
    quant_data_bin: str, ts_runner_path: Path, quantdesk_dir: Path
) -> None:
    if shutil.which(quant_data_bin) is None:
        raise RuntimeError(f"quant-data executable not found: {quant_data_bin}")
    if not ts_runner_path.exists():
        raise FileNotFoundError(f"TS runner not found: {ts_runner_path}")
    if shutil.which("pnpm") is None:
        raise RuntimeError("pnpm is required to run the TypeScript eval runner.")
    if not quantdesk_dir.exists():
        raise FileNotFoundError(f"QuantDesk directory not found: {quantdesk_dir}")
    help_envelope = call_quant_data(quant_data_bin, "help", {}, json_flag=True)
    methods = {method.get("name") for method in help_envelope.get("methods", [])}
    if "get-price-series" not in methods:
        raise RuntimeError("quant-data is missing required method: get-price-series")


def run_ts_runner(
    payload: dict[str, Any], *, ts_runner_path: Path, quantdesk_dir: Path
) -> dict[str, Any]:
    process = subprocess.run(
        ["pnpm", "--dir", str(quantdesk_dir), "exec", "tsx", str(ts_runner_path)],
        input=json.dumps(payload, ensure_ascii=False),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if process.returncode != 0:
        sys.stderr.write(process.stderr)
        raise RuntimeError(
            f"Strategy eval runner failed with exit code {process.returncode}."
        )
    if process.stderr.strip():
        sys.stderr.write(process.stderr)
    return json.loads(process.stdout)
