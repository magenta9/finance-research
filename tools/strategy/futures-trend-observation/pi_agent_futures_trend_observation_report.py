#!/usr/bin/env python3
"""Generate a dated domestic futures trend observation report via Pi agent."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path
from typing import Any

from pi_agent_futures_trend_observation_driver import (
    DEFAULT_APP_USER_DATA,
    FUTURES_SOURCE_PATH,
    PROJECT_ROOT,
    PiRpcClient,
    PiRpcError,
    build_pi_env,
    build_prompt,
    extract_rpc_commands,
    filter_contracts,
    has_skill_command,
    load_default_futures,
    resolve_pi_command,
    run_confirmation,
)


DEFAULT_REPORT_ROOT = (
    PROJECT_ROOT / "thoughts/shared/research/futures-trend-observation-agent"
)
TIMEFRAME_ORDER = {"1d": 0, "2d": 1, "1w": 2, "2w": 3}
SUMMARY_CONSISTENCY_ORDER = {"方向一致": 0, "多空混杂": 1}
SUMMARY_DIRECTION_ORDER = {"多头": 0, "空头": 1, "中性": 2, "不可用": 3}
SUMMARY_STATUS_ORDER = {
    "到达趋势观察位": 0,
    "有趋势但未到观察位": 1,
    "趋势不明确": 2,
    "不可用": 3,
    "未解析": 4,
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Call Pi agent trend observation skill for domestic futures and write a dated report folder.",
    )
    parser.add_argument(
        "--symbols",
        nargs="*",
        help="Optional underlying symbols or main symbols, for example RB AU AG9999.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        help="Only process the first N matched domestic futures contracts.",
    )
    parser.add_argument(
        "--end",
        default=date.today().isoformat(),
        help="End date passed to the trend observation script.",
    )
    parser.add_argument(
        "--market",
        default="COMMODITY",
        help="Market value passed to the trend observation script.",
    )
    parser.add_argument(
        "--report-date",
        default=date.today().isoformat(),
        help="Date segment for the report folder.",
    )
    parser.add_argument(
        "--report-root",
        type=Path,
        default=DEFAULT_REPORT_ROOT,
        help="Root folder for dated reports.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print prompts without starting the Pi RPC process.",
    )
    parser.add_argument(
        "--sdk-smoke",
        action="store_true",
        help="Start the Pi RPC process, list commands, then exit without running agent prompts.",
    )
    parser.add_argument(
        "--restart",
        action="store_true",
        help="Ignore an existing dated results.json and rebuild the report from scratch.",
    )
    parser.add_argument(
        "--run-timeout-seconds",
        type=float,
        default=240.0,
        help="Timeout for each Pi agent run.",
    )
    parser.add_argument(
        "--request-timeout-seconds",
        type=float,
        default=45.0,
        help="Timeout for Pi RPC request/response calls.",
    )
    parser.add_argument(
        "--agent-command",
        help='Override agent RPC command, for example: "pi --mode rpc --no-session".',
    )
    parser.add_argument(
        "--pi-command",
        dest="agent_command",
        help=argparse.SUPPRESS,
    )
    parser.add_argument(
        "--wrapper-command",
        dest="agent_command",
        help=argparse.SUPPRESS,
    )
    parser.add_argument(
        "--project-root",
        type=Path,
        default=PROJECT_ROOT,
        help="Project root.",
    )
    parser.add_argument(
        "--user-data-dir",
        type=Path,
        default=DEFAULT_APP_USER_DATA,
        help="User data dir that contains pi-agent config.",
    )
    parser.add_argument(
        "--workspace-dir",
        type=Path,
        help="Pi session cwd. Defaults to the project root.",
    )
    parser.add_argument(
        "--quant-data-command",
        default="go run ./cmd/quant-data",
        help="Command used inside the agent prompt for quant-data.",
    )
    return parser.parse_args()


def assistant_payload(result: dict[str, Any]) -> dict[str, Any]:
    assistant_json = result.get("assistantJson")
    if isinstance(assistant_json, dict):
        return assistant_json
    return {}


def nested_dict(payload: dict[str, Any], key: str) -> dict[str, Any]:
    value = payload.get(key)
    return value if isinstance(value, dict) else {}


def assistant_value(result: dict[str, Any], key: str, fallback: str = "") -> str:
    payload = assistant_payload(result)
    value = payload.get(key)
    if value is not None:
        return str(value)

    overall = nested_dict(payload, "overall")
    meta = nested_dict(payload, "meta")
    nested_keys = {
        "overallStatusLabel": (overall, "statusLabel"),
        "overallDirectionLabel": (overall, "directionLabel"),
        "directionConsistencyLabel": (overall, "directionConsistencyLabel"),
        "strongestTimeframe": (overall, "strongestTimeframe"),
        "latestDate": (meta, "latestDate"),
        "dataQualityStatus": (meta, "dataQualityStatus"),
    }
    nested = nested_keys.get(key)
    if nested:
        source, nested_key = nested
        nested_value = source.get(nested_key)
        if nested_value is not None:
            return str(nested_value)
    return fallback


def summary_consistency_label(result: dict[str, Any]) -> str:
    label = assistant_value(result, "directionConsistencyLabel")
    return label if label in SUMMARY_CONSISTENCY_ORDER else "其他/不可用"


def result_summary_sort_key(result: dict[str, Any]) -> tuple[int, int, str]:
    direction = assistant_value(result, "overallDirectionLabel")
    status = assistant_value(result, "overallStatusLabel", "未解析")
    symbol = str(result.get("symbol") or "")
    return (
        SUMMARY_DIRECTION_ORDER.get(direction, 99),
        SUMMARY_STATUS_ORDER.get(status, 99),
        symbol,
    )


def grouped_summary_results(
    results: list[dict[str, Any]],
) -> list[tuple[str, list[dict[str, Any]]]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for result in results:
        grouped.setdefault(summary_consistency_label(result), []).append(result)

    return [
        (label, sorted(items, key=result_summary_sort_key))
        for label, items in sorted(
            grouped.items(),
            key=lambda item: (SUMMARY_CONSISTENCY_ORDER.get(item[0], 99), item[0]),
        )
    ]


def md_cell(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).replace("\n", "<br>")
    return text.replace("|", "\\|")


def metric_value(metrics: dict[str, Any], key: str) -> str:
    value = metrics.get(key)
    if isinstance(value, float):
        return f"{value:.4f}"
    if value is None:
        return ""
    return str(value)


def timeframe_items(payload: dict[str, Any]) -> list[dict[str, Any]]:
    items = payload.get("timeframes")
    if not isinstance(items, list):
        return []
    valid_items = [item for item in items if isinstance(item, dict)]
    return sorted(
        valid_items,
        key=lambda item: TIMEFRAME_ORDER.get(str(item.get("timeframe") or ""), 99),
    )


def result_slug(result: dict[str, Any]) -> str:
    symbol = str(result.get("symbol") or "unknown").upper()
    return "".join(character if character.isalnum() else "-" for character in symbol)


def write_symbol_report(
    report_dir: Path, payload: dict[str, Any], result: dict[str, Any]
) -> str:
    symbol_dir = report_dir / "symbols"
    symbol_dir.mkdir(parents=True, exist_ok=True)
    file_name = f"{result_slug(result)}.md"
    report_path = symbol_dir / file_name
    assistant = assistant_payload(result)
    timeframes = timeframe_items(assistant)
    data_gaps = (
        assistant.get("dataGaps") if isinstance(assistant.get("dataGaps"), list) else []
    )
    overall_reasons = assistant.get("overallReasons")
    if not isinstance(overall_reasons, list):
        overall_reasons = nested_dict(assistant, "overall").get("reasons")
    if not isinstance(overall_reasons, list):
        overall_reasons = []

    lines = [
        f"# {result.get('symbol') or ''} {result.get('name') or ''} 趋势观察位报告",
        "",
        f"- 报告日期：`{payload['reportDate']}`",
        f"- 数据截止：`{payload['end']}`",
        f"- 交易所：`{result.get('exchange') or ''}`",
        f"- 运行状态：`{result.get('runType') or ''}`",
        f"- 总体评价：{assistant_value(result, 'overallStatusLabel', '未解析')}",
        f"- 总体方向：{assistant_value(result, 'overallDirectionLabel')}",
        f"- 方向共振：{assistant_value(result, 'directionConsistencyLabel')}",
        f"- 最强周期：{assistant_value(result, 'strongestTimeframe') or '无'}",
        f"- 数据日期：{assistant_value(result, 'latestDate') or '未解析'}",
        "",
        "本报告只确认趋势观察位，不包含交易执行、下单、仓位或买卖建议。",
    ]

    if overall_reasons:
        lines.extend(["", "## 总体原因", ""])
        lines.extend(f"- {reason}" for reason in overall_reasons)

    lines.extend(
        [
            "",
            "## 周期评价",
            "",
            "| 周期 | 状态 | 方向 | Bars | 日期 | 收盘 | EMA50 | 距 EMA50(ATR) | MACD 线(ATR) | 评价原因 |",
            "| --- | --- | --- | ---: | --- | ---: | ---: | ---: | ---: | --- |",
        ]
    )
    if timeframes:
        for item in timeframes:
            metrics = (
                item.get("metrics") if isinstance(item.get("metrics"), dict) else {}
            )
            reasons = (
                item.get("reasons") if isinstance(item.get("reasons"), list) else []
            )
            lines.append(
                "| "
                + " | ".join(
                    [
                        md_cell(item.get("timeframe")),
                        md_cell(item.get("statusLabel") or item.get("status")),
                        md_cell(item.get("directionLabel") or item.get("direction")),
                        md_cell(item.get("barCount")),
                        md_cell(metrics.get("asOf")),
                        md_cell(metric_value(metrics, "close")),
                        md_cell(metric_value(metrics, "ema50")),
                        md_cell(metric_value(metrics, "distanceToEma50Atr")),
                        md_cell(metric_value(metrics, "macdLineAtr")),
                        md_cell("<br>".join(str(reason) for reason in reasons)),
                    ]
                )
                + " |"
            )
    else:
        lines.append(
            "| 未解析 | 未解析 |  |  |  |  |  |  |  | assistant JSON 未包含 timeframes[] |"
        )

    if data_gaps:
        lines.extend(["", "## 数据缺口", ""])
        lines.extend(f"- {gap}" for gap in data_gaps)

    if result.get("error"):
        lines.extend(["", "## 运行错误", "", str(result.get("error"))])

    lines.extend(
        [
            "",
            "## 原始记录",
            "",
            f"- sessionId: `{result.get('sessionId') or ''}`",
            f"- runId: `{result.get('runId') or ''}`",
        ]
    )
    report_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return f"symbols/{file_name}"


def write_report_files(report_dir: Path, payload: dict[str, Any]) -> None:
    report_dir.mkdir(parents=True, exist_ok=True)
    results = payload["results"]
    completed = [
        result
        for result in results
        if result.get("runType") == "run_completed" and result.get("assistantJson")
    ]
    failed = [result for result in results if result not in completed]

    (report_dir / "results.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    with (report_dir / "assistant-raw.jsonl").open("w", encoding="utf-8") as output:
        for result in results:
            output.write(
                json.dumps(
                    {
                        "symbol": result.get("symbol"),
                        "name": result.get("name"),
                        "runType": result.get("runType"),
                        "assistantJson": result.get("assistantJson"),
                        "assistantText": result.get("assistantText"),
                        "error": result.get("error"),
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )

    def build_summary_table(
        title: str, table_results: list[dict[str, Any]]
    ) -> list[str]:
        if not table_results:
            return []
        lines = [
            f"### {title}",
            "",
            "| 品种 | 名称 | 交易所 | 状态 | 方向 | 共振 | 最强周期 | 数据日期 | 明细 |",
            "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        ]
        for result in table_results:
            symbol_report = write_symbol_report(report_dir, payload, result)
            lines.append(
                "| "
                + " | ".join(
                    [
                        md_cell(result.get("symbol") or ""),
                        md_cell(result.get("name") or ""),
                        md_cell(result.get("exchange") or ""),
                        md_cell(
                            assistant_value(result, "overallStatusLabel", "未解析")
                        ),
                        md_cell(assistant_value(result, "overallDirectionLabel")),
                        md_cell(assistant_value(result, "directionConsistencyLabel")),
                        md_cell(assistant_value(result, "strongestTimeframe")),
                        md_cell(assistant_value(result, "latestDate")),
                        f"[{result.get('symbol') or '明细'}]({symbol_report})",
                    ]
                )
                + " |"
            )
        return lines

    lines = [
        "# 国内期货趋势观察位 Agent 确认报告",
        "",
        f"- 报告日期：`{payload['reportDate']}`",
        f"- 数据截止：`{payload['end']}`",
        f"- 市场：`{payload['market']}`",
        "- 调用链路：`Python batch script -> pi --mode rpc -> futures-trend-observation skill`",
        f"- 品种数：`{len(results)}`，完成：`{len(completed)}`，失败/未解析：`{len(failed)}`",
        "",
        "本报告只确认趋势观察位，不包含交易执行、下单、仓位或买卖建议。",
        "",
        "## 汇总",
    ]

    for title, table_results in grouped_summary_results(completed):
        lines.extend(build_summary_table(title, table_results))

    if failed:
        lines.extend(["", "## 失败或未解析", ""])
        for result in failed:
            lines.append(
                f"- `{result.get('symbol')}` {result.get('name')}: {result.get('error') or 'assistant JSON 未解析'}"
            )

    lines.extend(
        [
            "",
            "## 产物",
            "",
            "- `results.json`: 结构化结果，包含每个 agent run 的 sessionId/runId 与 assistant JSON。",
            "- `assistant-raw.jsonl`: 每个品种的原始 assistant 输出，便于排查未解析结果。",
            "- `symbols/*.md`: 每个标的一份明细报告，包含总体评价和逐周期评价。",
        ]
    )
    (report_dir / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def load_existing_results(report_dir: Path, restart: bool) -> list[dict[str, Any]]:
    if restart:
        return []
    results_path = report_dir / "results.json"
    if not results_path.exists():
        return []
    data = json.loads(results_path.read_text(encoding="utf-8"))
    results = data.get("results")
    return results if isinstance(results, list) else []


def main() -> int:
    args = parse_args()
    args.project_root = args.project_root.expanduser().resolve()
    report_dir = args.report_root.expanduser().resolve() / args.report_date
    contracts = filter_contracts(
        load_default_futures(
            args.project_root / FUTURES_SOURCE_PATH.relative_to(PROJECT_ROOT)
        ),
        args.symbols,
        args.limit,
    )

    if args.dry_run:
        print(f"Report folder: {report_dir}")
        for contract in contracts:
            print(f"--- {contract.main_symbol} {contract.name} ---")
            print(build_prompt(contract, args))
        return 0

    client = PiRpcClient(
        command=resolve_pi_command(args),
        cwd=args.project_root,
        env=build_pi_env(args),
        request_timeout_seconds=args.request_timeout_seconds,
    )
    client.start()

    try:
        state = client.request("get_state")
        command_payload = client.request("get_commands")
        commands = extract_rpc_commands(command_payload)
        command_names = [command.get("name") for command in commands]
        if not has_skill_command(commands, "futures-trend-observation"):
            raise PiRpcError("Pi RPC did not discover skill:futures-trend-observation.")

        if args.sdk_smoke:
            print(
                json.dumps(
                    {
                        "ok": True,
                        "reportDir": str(report_dir),
                        "state": state,
                        "commands": command_names,
                    },
                    ensure_ascii=False,
                    indent=2,
                )
            )
            return 0

        results: list[dict[str, Any]] = load_existing_results(report_dir, args.restart)
        completed_symbols = {
            result.get("symbol")
            for result in results
            if result.get("runType") == "run_completed" and result.get("assistantJson")
        }
        payload = {
            "generatedAt": date.today().isoformat(),
            "reportDate": args.report_date,
            "end": args.end,
            "market": args.market,
            "reportDir": str(report_dir),
            "agentCommand": resolve_pi_command(args),
            "sdk": "pi --mode rpc",
            "results": results,
        }
        for index, contract in enumerate(contracts, start=1):
            if contract.main_symbol in completed_symbols:
                print(
                    f"[{index}/{len(contracts)}] skipping {contract.main_symbol} {contract.name} (already completed)",
                    file=sys.stderr,
                )
                continue
            print(
                f"[{index}/{len(contracts)}] confirming {contract.main_symbol} {contract.name}...",
                file=sys.stderr,
            )
            try:
                results.append(run_confirmation(client, contract, args))
            except Exception as error:
                results.append(
                    {
                        "symbol": contract.main_symbol,
                        "underlyingSymbol": contract.symbol,
                        "name": contract.name,
                        "exchange": contract.exchange,
                        "runType": "script_error",
                        "error": str(error),
                        "assistantJson": None,
                        "assistantText": "",
                    }
                )
            write_report_files(report_dir, payload)
            print(
                f"[{index}/{len(contracts)}] wrote {contract.main_symbol}; total saved {len(results)}",
                file=sys.stderr,
            )

        write_report_files(report_dir, payload)
        print(
            json.dumps(
                {
                    "reportDir": str(report_dir),
                    "report": str(report_dir / "report.md"),
                    "resultsJson": str(report_dir / "results.json"),
                    "count": len(results),
                    "failed": len(
                        [
                            result
                            for result in results
                            if result.get("runType") != "run_completed"
                            or not result.get("assistantJson")
                        ]
                    ),
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(main())
