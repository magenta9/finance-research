#!/usr/bin/env python3
"""Confirm futures trend observation results through the Pi RPC CLI."""

from __future__ import annotations

import argparse
import json
import os
import queue
import re
import shlex
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any


SCRIPT_PATH = Path(__file__).resolve()


def resolve_project_root(start: Path) -> Path:
    for candidate in [start.parent, *start.parents]:
        if (candidate / "tools/data/quant-data/go.mod").exists() and (
            candidate / ".agents/skills"
        ).exists():
            return candidate
    raise RuntimeError(f"Could not resolve project root from {start}.")


PROJECT_ROOT = resolve_project_root(SCRIPT_PATH)
FUTURES_SOURCE_PATH = SCRIPT_PATH.with_name("contracts.json")
SKILL_ANALYZE_PATH = "tools/strategy/futures-trend-observation/analyze.py"
DEFAULT_APP_USER_DATA = PROJECT_ROOT / ".finance-research"


@dataclass(frozen=True)
class FuturesContract:
    symbol: str
    name: str
    exchange: str

    @property
    def main_symbol(self) -> str:
        return f"{self.symbol}9999"


class PiRpcError(RuntimeError):
    pass


PiWrapperError = PiRpcError


class PiRpcClient:
    def __init__(
        self,
        command: list[str],
        cwd: Path,
        env: dict[str, str],
        request_timeout_seconds: float,
    ) -> None:
        self.command = command
        self.cwd = cwd
        self.env = env
        self.request_timeout_seconds = request_timeout_seconds
        self.process: subprocess.Popen[str] | None = None
        self.pending: dict[str, queue.Queue[dict[str, Any]]] = {}
        self.events: queue.Queue[dict[str, Any]] = queue.Queue()
        self.stderr_lines: queue.Queue[str] = queue.Queue()
        self.stdout_lines: queue.Queue[str] = queue.Queue()
        self.extension_ui_events: queue.Queue[dict[str, Any]] = queue.Queue()
        self.write_lock = threading.Lock()

    def start(self) -> None:
        self.process = subprocess.Popen(
            self.command,
            cwd=self.cwd,
            env=self.env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )

        threading.Thread(target=self._read_stdout, daemon=True).start()
        threading.Thread(target=self._read_stderr, daemon=True).start()

    def close(self) -> None:
        if not self.process:
            return

        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.process.kill()

    def request(
        self,
        command_type: str,
        fields: dict[str, Any] | None = None,
        timeout_seconds: float | None = None,
    ) -> Any:
        request_id = str(uuid.uuid4())
        response_queue: queue.Queue[dict[str, Any]] = queue.Queue(maxsize=1)
        self.pending[request_id] = response_queue

        message: dict[str, Any] = {
            "id": request_id,
            "type": command_type,
        }
        if fields:
            message.update(fields)

        self._write(message)

        try:
            response = response_queue.get(
                timeout=timeout_seconds or self.request_timeout_seconds
            )
        except queue.Empty as exc:
            raise PiRpcError(
                f"Timed out waiting for Pi RPC response to {command_type}."
            ) from exc
        finally:
            self.pending.pop(request_id, None)

        if response.get("success") is True:
            return response.get("data")

        error = response.get("error")
        if isinstance(error, dict):
            message_text = str(error.get("message") or error)
        elif isinstance(error, str):
            message_text = error
        else:
            message_text = "Pi RPC request failed."
        raise PiRpcError(message_text)

    def wait_for_agent_end(
        self, session_id: str, timeout_seconds: float
    ) -> dict[str, Any]:
        deadline = time.monotonic() + timeout_seconds
        assistant_text_parts: list[str] = []
        thinking_text_parts: list[str] = []

        while time.monotonic() < deadline:
            remaining = max(0.1, deadline - time.monotonic())
            try:
                event = self.events.get(timeout=min(remaining, 1.0))
            except queue.Empty:
                self._raise_if_exited()
                continue

            if not rpc_event_matches_session(event, session_id):
                continue

            event_type = rpc_message_type(event)
            if event_type == "message_update":
                delta = extract_message_delta(event)
                if not delta:
                    continue
                if is_thinking_message_delta(event):
                    thinking_text_parts.append(delta)
                else:
                    assistant_text_parts.append(delta)
                continue

            if event_type == "agent_end":
                event["assistantText"] = "".join(assistant_text_parts).strip()
                event["thinkingText"] = "".join(thinking_text_parts).strip()
                return event

            if event_type in {"run_completed", "run_failed", "run_cancelled"}:
                return event

        raise PiRpcError(f"Timed out waiting for Pi RPC session {session_id}.")

    def _write(self, message: dict[str, Any]) -> None:
        self._raise_if_exited()
        if not self.process or not self.process.stdin:
            raise PiRpcError("Pi RPC stdin is not available.")

        line = json.dumps(message, ensure_ascii=False)
        with self.write_lock:
            self.process.stdin.write(f"{line}\n")
            self.process.stdin.flush()

    def _read_stdout(self) -> None:
        if not self.process or not self.process.stdout:
            return

        for line in self.process.stdout:
            line = line.strip()
            if not line:
                continue

            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                self.stdout_lines.put(f"non-json stdout: {line[:300]}")
                continue

            self._route_stdout_message(message)

    def _read_stderr(self) -> None:
        if not self.process or not self.process.stderr:
            return

        for line in self.process.stderr:
            line = line.strip()
            if line:
                self.stderr_lines.put(line)

    def _route_stdout_message(self, message: dict[str, Any]) -> None:
        message_type = rpc_message_type(message)

        if message_type == "response":
            request_id = message.get("id")
            if isinstance(request_id, str) and request_id in self.pending:
                self.pending[request_id].put(message)
            return

        if message_type == "extension_ui_request":
            self._handle_extension_ui_request(message)
            return

        self.events.put(message)

    def _handle_extension_ui_request(self, message: dict[str, Any]) -> None:
        self.extension_ui_events.put(message)
        method = message.get("method")
        request_id = message.get("id")
        if method in {
            "notify",
            "setStatus",
            "setWidget",
            "setTitle",
            "set_editor_text",
        }:
            return
        if isinstance(request_id, str):
            self._write(
                {
                    "type": "extension_ui_response",
                    "id": request_id,
                    "cancelled": True,
                }
            )

    def _handle_wrapper_request(self, message: dict[str, Any]) -> None:
        request_id = message.get("id")
        method = message.get("method")
        if not isinstance(request_id, str):
            return

        self._write(
            {
                "id": request_id,
                "type": "response",
                "success": False,
                "error": {
                    "code": "TOOL_HOST_UNAVAILABLE",
                    "message": f"Python SDK confirmation driver does not serve finance tool host requests ({method}).",
                },
            }
        )

    def _raise_if_exited(self) -> None:
        if self.process and self.process.poll() is not None:
            stderr = drain_queue(self.stderr_lines)[-10:]
            stdout = drain_queue(self.stdout_lines)[-10:]
            diagnostics = [*stdout, *stderr]
            suffix = "\n" + "\n".join(diagnostics) if diagnostics else ""
            raise PiRpcError(
                f"Pi RPC process exited with code {self.process.returncode}.{suffix}"
            )


PiWrapperClient = PiRpcClient


def rpc_message_type(message: dict[str, Any]) -> str:
    value = message.get("type") or message.get("event")
    return value if isinstance(value, str) else ""


def rpc_event_matches_session(event: dict[str, Any], session_id: str) -> bool:
    candidates = [event.get("sessionId"), event.get("session_id")]
    data = event.get("data")
    if isinstance(data, dict):
        candidates.extend([data.get("sessionId"), data.get("session_id")])
    message = event.get("message")
    if isinstance(message, dict):
        candidates.extend([message.get("sessionId"), message.get("session_id")])

    string_candidates = [
        candidate for candidate in candidates if isinstance(candidate, str)
    ]
    return not string_candidates or session_id in string_candidates


def extract_message_delta(event: dict[str, Any]) -> str:
    assistant_event = event.get("assistantMessageEvent")
    if not isinstance(assistant_event, dict):
        data = event.get("data")
        if isinstance(data, dict):
            assistant_event = data.get("assistantMessageEvent")

    if isinstance(assistant_event, dict):
        delta = assistant_event.get("delta")
        if isinstance(delta, str):
            return delta
        text = assistant_event.get("text")
        if isinstance(text, str):
            return text

    data = event.get("data")
    if isinstance(data, dict):
        delta = data.get("delta") or data.get("message")
        if isinstance(delta, str):
            return delta

    delta = event.get("delta")
    return delta if isinstance(delta, str) else ""


def is_thinking_message_delta(event: dict[str, Any]) -> bool:
    assistant_event = event.get("assistantMessageEvent")
    if not isinstance(assistant_event, dict):
        data = event.get("data")
        assistant_event = (
            data.get("assistantMessageEvent") if isinstance(data, dict) else None
        )
    if not isinstance(assistant_event, dict):
        return False
    return assistant_event.get("type") == "thinking_delta"


def drain_queue(items: queue.Queue[Any]) -> list[Any]:
    drained: list[Any] = []
    while True:
        try:
            drained.append(items.get_nowait())
        except queue.Empty:
            return drained


def load_default_futures(source_path: Path) -> list[FuturesContract]:
    items = json.loads(source_path.read_text(encoding="utf-8"))
    if not isinstance(items, list):
        raise RuntimeError(f"Expected a JSON array in {source_path}.")

    contracts: list[FuturesContract] = []
    for item in items:
        if not isinstance(item, dict):
            raise RuntimeError(f"Invalid futures contract item in {source_path}.")
        contracts.append(
            FuturesContract(
                symbol=str(item["symbol"]).upper(),
                name=str(item["name"]),
                exchange=str(item["exchange"]).upper(),
            )
        )

    if not contracts:
        raise RuntimeError(f"No futures contracts parsed from {source_path}.")
    return contracts


def filter_contracts(
    contracts: list[FuturesContract], symbols: list[str] | None, limit: int | None
) -> list[FuturesContract]:
    selected = contracts

    if symbols:
        wanted = {normalize_symbol(symbol) for symbol in symbols}
        selected = [
            contract
            for contract in contracts
            if contract.symbol in wanted or contract.main_symbol in wanted
        ]

        missing = sorted(
            wanted
            - {contract.symbol for contract in selected}
            - {contract.main_symbol for contract in selected}
        )
        if missing:
            raise RuntimeError(f"Unknown futures symbol(s): {', '.join(missing)}")

    if limit is not None:
        selected = selected[: max(0, limit)]

    return selected


def normalize_symbol(symbol: str) -> str:
    normalized = symbol.strip().upper()
    return (
        normalized[:-4]
        if normalized.endswith("9999") and len(normalized) > 4
        else normalized
    )


def resolve_pi_command(args: Any) -> list[str]:
    if getattr(args, "agent_command", None):
        return shlex.split(args.agent_command)

    return ["pi", "--mode", "rpc", "--no-session"]


resolve_wrapper_command = resolve_pi_command


def build_pi_env(args: argparse.Namespace) -> dict[str, str]:
    user_data_dir = args.user_data_dir.expanduser().resolve()
    pi_root = user_data_dir / "pi-agent"
    workspace_dir = (args.workspace_dir or args.project_root).expanduser().resolve()

    directories = {
        "FINANCE_RESEARCH_PI_AGENT_DIR": pi_root / "config",
        "FINANCE_RESEARCH_PI_SESSION_DIR": pi_root / "sessions",
        "FINANCE_RESEARCH_PI_TOOL_INVOCATION_DIR": pi_root / "tool-invocations",
        "FINANCE_RESEARCH_PI_WORKSPACE_DIR": workspace_dir,
    }
    for directory in directories.values():
        directory.mkdir(parents=True, exist_ok=True)

    env = os.environ.copy()
    env.update({key: str(value) for key, value in directories.items()})
    env["PI_CODING_AGENT_DIR"] = str(directories["FINANCE_RESEARCH_PI_AGENT_DIR"])
    env["PI_CODING_AGENT_SESSION_DIR"] = str(
        directories["FINANCE_RESEARCH_PI_SESSION_DIR"]
    )
    return env


def build_prompt(contract: FuturesContract, args: argparse.Namespace) -> str:
    quant_data_parts = shlex.split(args.quant_data_command)
    quant_data_binary = quant_data_parts[0] if quant_data_parts else "quant-data"
    quant_data_args = quant_data_parts[1:]
    quant_data_cli_flags = " ".join(
        [f"--quant-data {shlex.quote(quant_data_binary)}"]
        + [f"--quant-data-arg {shlex.quote(part)}" for part in quant_data_args]
    )
    command = (
        f"uv run python {SKILL_ANALYZE_PATH} "
        f"--symbol {contract.main_symbol} --market {args.market} --end {args.end} "
        f"--quant-data-cwd ./tools/data/quant-data {quant_data_cli_flags}"
    )

    return "\n".join(
        [
            "请使用 futures-trend-observation skill 确认下面期货品种的趋势观察结果。",
            f"品种：{contract.name} ({contract.main_symbol})，交易所：{contract.exchange}，market：{args.market}。",
            "必须从项目根目录调用确定性脚本，不要直接读 SQLite，不要编造行情或指标。",
            f"推荐命令：{command}",
            "只允许给出趋势观察位状态，不要给交易执行、下单、仓位或买卖建议。",
            "请在最终回答里只输出一个 JSON 对象，不要 Markdown，不要解释。Schema:",
            json.dumps(
                {
                    "symbol": contract.main_symbol,
                    "name": contract.name,
                    "exchange": contract.exchange,
                    "overallStatusLabel": "到达趋势观察位|有趋势但未到观察位|趋势不明确|不可用",
                    "overallDirectionLabel": "多头|空头|中性|不可用",
                    "directionConsistencyLabel": "方向一致|多空混杂|不可用",
                    "strongestTimeframe": "1d|2d|1w|2w|null",
                    "latestDate": "YYYY-MM-DD|null",
                    "dataQualityStatus": "available|partial|unavailable|null",
                    "warningCount": 0,
                    "overallReasons": ["只引用确定性脚本 overall.reasons 的中文原因"],
                    "timeframes": [
                        {
                            "timeframe": "1d|2d|1w|2w",
                            "statusLabel": "到达趋势观察位|有趋势但未到观察位|趋势不明确|无法判断",
                            "directionLabel": "多头|空头|中性|多空混杂|不可用",
                            "barCount": 0,
                            "metrics": {
                                "asOf": "YYYY-MM-DD|null",
                                "close": 0,
                                "ema50": 0,
                                "atr": 0,
                                "distanceToEma50Atr": 0,
                                "ema50Slope5": 0,
                                "macdLine": 0,
                                "macdSignal": 0,
                                "macdHistogram": 0,
                                "macdLineAtr": 0,
                            },
                            "reasons": [
                                "只引用确定性脚本 timeframes[].reasons 的中文原因"
                            ],
                            "dataGaps": [],
                        }
                    ],
                    "dataGaps": [],
                    "nonExecution": True,
                },
                ensure_ascii=False,
            ),
            "timeframes 必须覆盖 1d、2d、1w、2w 四个周期；不得省略不可用周期。",
        ]
    )


def message_text(message: dict[str, Any]) -> str:
    content = message.get("content") or message.get("text")
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                text = item.get("text") or item.get("content")
                if isinstance(text, str):
                    parts.append(text)
        return "".join(parts).strip()
    return ""


def latest_assistant_content(transcript: dict[str, Any] | list[Any]) -> str:
    messages = (
        transcript.get("messages") if isinstance(transcript, dict) else transcript
    )
    if not isinstance(messages, list):
        return ""

    for message in reversed(messages):
        if not isinstance(message, dict):
            continue
        if message.get("role") == "assistant" and message.get("phase") != "thinking":
            content = message_text(message)
            if content:
                return content
    return ""


def agent_end_messages(event: dict[str, Any]) -> list[Any]:
    messages = event.get("messages")
    if isinstance(messages, list):
        return messages
    data = event.get("data")
    if isinstance(data, dict) and isinstance(data.get("messages"), list):
        return data["messages"]
    return []


def extract_rpc_commands(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, dict) and isinstance(payload.get("commands"), list):
        commands = payload["commands"]
    elif isinstance(payload, list):
        commands = payload
    else:
        commands = []
    return [command for command in commands if isinstance(command, dict)]


def has_skill_command(commands: list[dict[str, Any]], skill_name: str) -> bool:
    expected = f"skill:{skill_name}"
    accepted_names = {expected, skill_name, f"/{expected}", f"/{skill_name}"}
    for command in commands:
        if command.get("source") != "skill":
            continue
        values = [command.get("name"), command.get("command"), command.get("id")]
        if any(isinstance(value, str) and value in accepted_names for value in values):
            return True
    return False


def extract_json_object(text: str) -> dict[str, Any] | None:
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = re.sub(r"^```(?:json)?\s*", "", stripped)
        stripped = re.sub(r"\s*```$", "", stripped)

    candidates = [stripped]
    brace_match = re.search(r"\{[\s\S]*\}", stripped)
    if brace_match:
        candidates.append(brace_match.group(0))

    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        return parsed if isinstance(parsed, dict) else None
    return None


def run_confirmation(
    client: PiRpcClient, contract: FuturesContract, args: Any
) -> dict[str, Any]:
    prompt = "/skill:futures-trend-observation\n\n" + build_prompt(contract, args)
    new_session = client.request("new_session")
    if isinstance(new_session, dict) and new_session.get("cancelled"):
        raise PiRpcError("Pi RPC new_session was cancelled.")

    state = client.request("get_state")
    session_id = (
        state.get("sessionId") or state.get("session_id")
        if isinstance(state, dict)
        else None
    )
    if not isinstance(session_id, str) or not session_id:
        session_id = str(uuid.uuid4())

    run_id = str(uuid.uuid4())
    client.request("prompt", {"message": prompt})
    terminal_event = client.wait_for_agent_end(session_id, args.run_timeout_seconds)

    streamed_text = str(terminal_event.get("assistantText") or "").strip()
    message_text_value = latest_assistant_content(agent_end_messages(terminal_event))
    last_assistant_text = ""
    try:
        last_assistant = client.request("get_last_assistant_text")
        if isinstance(last_assistant, dict) and isinstance(
            last_assistant.get("text"), str
        ):
            last_assistant_text = last_assistant["text"].strip()
    except PiRpcError:
        last_assistant_text = ""

    assistant_content = last_assistant_text or message_text_value or streamed_text
    parsed = extract_json_object(assistant_content)
    event_type = rpc_message_type(terminal_event)
    run_type = (
        "run_completed" if event_type == "agent_end" else event_type or "run_completed"
    )
    diagnostics = drain_queue(client.extension_ui_events)

    return {
        "symbol": contract.main_symbol,
        "underlyingSymbol": contract.symbol,
        "name": contract.name,
        "exchange": contract.exchange,
        "runId": run_id,
        "sessionId": session_id,
        "runType": run_type,
        "error": terminal_event.get("error"),
        "assistantJson": parsed,
        "assistantText": assistant_content,
        "diagnostics": {"extensionUiRequests": diagnostics} if diagnostics else {},
    }
