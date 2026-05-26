#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import date, datetime, timedelta, timezone
from typing import Any

from trend_observation_engine import analyze_rows, normalize_rows, unavailable_result


DEFAULT_QUANT_DATA_TIMEOUT_SECONDS = 30


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Analyze futures Trend Observation Setup from quant-data prices."
    )
    parser.add_argument("--symbol", required=True)
    parser.add_argument("--market", required=True)
    parser.add_argument("--asset-id", default="")
    parser.add_argument("--start", default="")
    parser.add_argument("--end", default="")
    parser.add_argument("--lookback-days", type=int, default=3650)
    parser.add_argument(
        "--quant-data", default=os.environ.get("QUANT_DATA_CLI", "quant-data")
    )
    parser.add_argument("--quant-data-arg", action="append", default=[])
    parser.add_argument("--quant-data-cwd", default=os.getcwd())
    parser.add_argument(
        "--quant-data-timeout-seconds",
        type=int,
        default=DEFAULT_QUANT_DATA_TIMEOUT_SECONDS,
    )
    parser.add_argument("--fixture-provider", action="store_true")
    return parser.parse_args()


def utc_today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def shift_days(date_text: str, days: int) -> str:
    return (strict_iso_date(date_text) + timedelta(days=days)).isoformat()


def strict_iso_date(date_text: str) -> date:
    if len(date_text) != 10 or date_text[4] != "-" or date_text[7] != "-":
        raise ValueError("date must be YYYY-MM-DD")
    return date.fromisoformat(date_text)


def validate_date_inputs(
    args: argparse.Namespace, start: str, end: str
) -> list[str]:
    gaps: list[str] = []
    parsed_start: date | None = None
    parsed_end: date | None = None
    if start:
        try:
            parsed_start = strict_iso_date(start)
        except ValueError:
            gaps.append(f"start must be YYYY-MM-DD: {start}")
    try:
        parsed_end = strict_iso_date(end)
    except ValueError:
        gaps.append(f"end must be YYYY-MM-DD: {end}")
    if parsed_start is not None and parsed_end is not None and parsed_start > parsed_end:
        gaps.append("start must be on or before end")
    if args.lookback_days <= 0:
        gaps.append("lookback-days must be greater than 0")
    return gaps


def run_quant_data(
    args: argparse.Namespace, input_payload: dict[str, Any]
) -> dict[str, Any]:
    command = [args.quant_data, *args.quant_data_arg, "get-price-series"]
    timeout_seconds = quant_data_timeout_seconds(args)
    env = os.environ.copy()
    if args.fixture_provider:
        env["QUANT_DATA_FIXTURE_PROVIDER"] = "1"
    try:
        process = subprocess.run(
            command,
            input=json.dumps(input_payload) + "\n",
            text=True,
            cwd=args.quant_data_cwd,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
            timeout=timeout_seconds,
        )
    except OSError as error:
        raise RuntimeError(f"quant-data could not start: {error}") from error
    except subprocess.TimeoutExpired as error:
        raise RuntimeError(f"quant-data timed out after {timeout_seconds}s") from error
    if process.returncode != 0:
        detail = process.stderr.strip() or process.stdout.strip() or "no output"
        raise RuntimeError(f"quant-data exited with {process.returncode}: {detail}")
    try:
        envelope = json.loads(process.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"quant-data returned invalid JSON: {error}") from error
    if not isinstance(envelope, dict):
        raise RuntimeError("quant-data returned non-object JSON envelope")
    return envelope


def quant_data_timeout_seconds(args: argparse.Namespace) -> int:
    value = getattr(
        args, "quant_data_timeout_seconds", DEFAULT_QUANT_DATA_TIMEOUT_SECONDS
    )
    return value if isinstance(value, int) else DEFAULT_QUANT_DATA_TIMEOUT_SECONDS


def malformed_quant_data_result(
    args: argparse.Namespace, start: str, end: str, message: str
) -> dict[str, Any]:
    return unavailable_result(
        asset_id=args.asset_id,
        data_gaps=[message],
        end=end,
        market=args.market,
        start=start,
        symbol=args.symbol,
    )


def analyze(args: argparse.Namespace) -> dict[str, Any]:
    end = args.end or utc_today()
    try:
        start = args.start or shift_days(end, -args.lookback_days)
    except ValueError:
        start = args.start or ""
    input_gaps = validate_date_inputs(args, start, end)
    if input_gaps:
        return unavailable_result(
            asset_id=args.asset_id,
            data_gaps=input_gaps,
            end=end,
            market=args.market,
            start=start,
            symbol=args.symbol,
        )
    if quant_data_timeout_seconds(args) <= 0:
        return unavailable_result(
            asset_id=args.asset_id,
            data_gaps=["quant-data-timeout-seconds must be greater than 0"],
            end=end,
            market=args.market,
            start=start,
            symbol=args.symbol,
        )
    input_payload = {
        "symbol": args.symbol,
        "market": args.market,
        "start": start,
        "end": end,
    }
    if args.asset_id:
        input_payload["assetId"] = args.asset_id

    try:
        envelope = run_quant_data(args, input_payload)
    except RuntimeError as error:
        return unavailable_result(
            asset_id=args.asset_id,
            data_gaps=[f"quant-data invocation failed: {error}"],
            end=end,
            market=args.market,
            start=start,
            symbol=args.symbol,
        )

    if not envelope.get("ok"):
        maintenance_error = envelope.get("maintenanceError")
        if not isinstance(maintenance_error, dict):
            maintenance_error = {}
        code = str(maintenance_error.get("code") or "QUANT_DATA_UNAVAILABLE")
        message = str(
            maintenance_error.get("message")
            or "quant-data returned an unavailable envelope"
        )
        return unavailable_result(
            asset_id=args.asset_id,
            data_gaps=[f"{code}: {message}"],
            end=end,
            market=args.market,
            start=start,
            symbol=args.symbol,
        )

    data = envelope.get("data")
    if not isinstance(data, dict):
        return malformed_quant_data_result(
            args, start, end, "quant-data returned malformed price payload"
        )
    prices = data.get("prices")
    if not isinstance(prices, list):
        return malformed_quant_data_result(
            args, start, end, "quant-data returned malformed price rows"
        )

    rows = normalize_rows(prices)
    if not rows:
        return unavailable_result(
            asset_id=args.asset_id,
            data_gaps=["quant-data returned no usable daily OHLC rows"],
            end=end,
            market=args.market,
            start=start,
            symbol=args.symbol,
        )

    return analyze_rows(
        asset_id=args.asset_id,
        end=end,
        envelope=envelope,
        market=args.market,
        rows=rows,
        start=start,
        symbol=args.symbol,
    )


def main() -> int:
    args = parse_args()
    result = analyze(args)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
