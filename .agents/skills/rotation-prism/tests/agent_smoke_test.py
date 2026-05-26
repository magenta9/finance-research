#!/usr/bin/env python3
"""Agent smoke test for the rotation-prism skill via Pi RPC.

The validation name is intentionally generic: agent smoke. Pi RPC is the current
transport used by this repository, not the concept this test is named after.
"""

from __future__ import annotations

import argparse
import json
import os
import queue
import shlex
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Any


SKILL_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = SKILL_DIR.parents[2]
DEFAULT_USER_DATA_DIR = PROJECT_ROOT / ".finance-research"


class AgentSmokeError(RuntimeError):
    pass


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
        self.write_lock = threading.Lock()

    def start(self) -> None:
        try:
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
        except OSError as error:
            raise AgentSmokeError(
                f"agent RPC process could not start: {error}"
            ) from error

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

    def request(self, command_type: str, fields: dict[str, Any] | None = None) -> Any:
        request_id = str(uuid.uuid4())
        response_queue: queue.Queue[dict[str, Any]] = queue.Queue(maxsize=1)
        self.pending[request_id] = response_queue
        message: dict[str, Any] = {"id": request_id, "type": command_type}
        if fields:
            message.update(fields)
        self._write(message)
        try:
            response = response_queue.get(timeout=self.request_timeout_seconds)
        except queue.Empty as error:
            raise AgentSmokeError(f"timed out waiting for {command_type}") from error
        finally:
            self.pending.pop(request_id, None)
        if response.get("success") is True:
            return response.get("data")
        raise AgentSmokeError(str(response.get("error") or response))

    def wait_for_agent_end(self, timeout_seconds: float) -> dict[str, Any]:
        deadline = time.monotonic() + timeout_seconds
        assistant_text_parts: list[str] = []
        while time.monotonic() < deadline:
            try:
                event = self.events.get(timeout=min(1.0, deadline - time.monotonic()))
            except queue.Empty:
                self._raise_if_exited()
                continue
            event_type = rpc_message_type(event)
            if event_type == "message_update":
                delta = extract_message_delta(event)
                if delta:
                    assistant_text_parts.append(delta)
                continue
            if event_type in {
                "agent_end",
                "run_completed",
                "run_failed",
                "run_cancelled",
            }:
                event["assistantText"] = "".join(assistant_text_parts).strip()
                return event
        raise AgentSmokeError("timed out waiting for agent run")

    def _write(self, message: dict[str, Any]) -> None:
        self._raise_if_exited()
        if not self.process or not self.process.stdin:
            raise AgentSmokeError("agent RPC stdin is unavailable")
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
            request_id = message.get("id")
            if rpc_message_type(message) == "response" and isinstance(request_id, str):
                if request_id in self.pending:
                    self.pending[request_id].put(message)
                continue
            self.events.put(message)

    def _read_stderr(self) -> None:
        if not self.process or not self.process.stderr:
            return
        for line in self.process.stderr:
            line = line.strip()
            if line:
                self.stderr_lines.put(line)

    def _raise_if_exited(self) -> None:
        if self.process and self.process.poll() is not None:
            diagnostics = [
                *drain_queue(self.stdout_lines),
                *drain_queue(self.stderr_lines),
            ]
            suffix = "\n" + "\n".join(diagnostics[-10:]) if diagnostics else ""
            raise AgentSmokeError(
                f"agent RPC process exited with code {self.process.returncode}.{suffix}"
            )


def rpc_message_type(message: dict[str, Any]) -> str:
    value = message.get("type") or message.get("event")
    return value if isinstance(value, str) else ""


def extract_message_delta(event: dict[str, Any]) -> str:
    assistant_event = event.get("assistantMessageEvent")
    if not isinstance(assistant_event, dict):
        data = event.get("data")
        assistant_event = (
            data.get("assistantMessageEvent") if isinstance(data, dict) else None
        )
    if isinstance(assistant_event, dict):
        delta = assistant_event.get("delta") or assistant_event.get("text")
        if isinstance(delta, str):
            return delta
    data = event.get("data")
    if isinstance(data, dict):
        delta = data.get("delta") or data.get("message")
        if isinstance(delta, str):
            return delta
    delta = event.get("delta")
    return delta if isinstance(delta, str) else ""


def drain_queue(items: queue.Queue[Any]) -> list[Any]:
    drained: list[Any] = []
    while True:
        try:
            drained.append(items.get_nowait())
        except queue.Empty:
            return drained


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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run rotation-prism agent smoke via Pi RPC."
    )
    parser.add_argument(
        "--agent-command",
        default="pi --mode rpc --no-session",
        help="Agent RPC command. Kept generic at the test interface even when using Pi RPC.",
    )
    parser.add_argument("--user-data-dir", type=Path, default=DEFAULT_USER_DATA_DIR)
    parser.add_argument("--workspace-dir", type=Path, default=PROJECT_ROOT)
    parser.add_argument("--request-timeout-seconds", type=float, default=45.0)
    parser.add_argument("--run-timeout-seconds", type=float, default=180.0)
    parser.add_argument(
        "--run-prompt",
        action="store_true",
        help="After discovery, run a minimal prompt through skill:rotation-prism.",
    )
    return parser.parse_args()


def build_agent_env(args: argparse.Namespace) -> dict[str, str]:
    user_data_dir = args.user_data_dir.expanduser().resolve()
    pi_root = user_data_dir / "pi-agent"
    config_dir = pi_root / "config"
    session_dir = pi_root / "sessions"
    invocation_dir = pi_root / "tool-invocations"
    for directory in [config_dir, session_dir, invocation_dir, args.workspace_dir]:
        directory.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env["PI_CODING_AGENT_DIR"] = str(config_dir)
    env["PI_CODING_AGENT_SESSION_DIR"] = str(session_dir)
    env["FINANCE_RESEARCH_PI_TOOL_INVOCATION_DIR"] = str(invocation_dir)
    env["FINANCE_RESEARCH_PI_WORKSPACE_DIR"] = str(
        args.workspace_dir.expanduser().resolve()
    )
    return env


def run_prompt(client: PiRpcClient, args: argparse.Namespace) -> str:
    prompt = "\n".join(
        [
            "/skill:rotation-prism",
            "",
            "请使用 rotation-prism skill 分析 510300 相对 510300。",
            "只需要确认 Skill 能被调用；如果数据不足，请明确输出数据缺口，不要编造市场结论。",
        ]
    )
    client.request("new_session")
    client.request("prompt", {"message": prompt})
    event = client.wait_for_agent_end(args.run_timeout_seconds)
    text = str(event.get("assistantText") or "").strip()
    if not text:
        try:
            latest = client.request("get_last_assistant_text")
        except AgentSmokeError:
            latest = None
        if isinstance(latest, dict) and isinstance(latest.get("text"), str):
            text = latest["text"].strip()
    if "rotation" not in text.lower() and "轮动" not in text:
        raise AgentSmokeError("agent response did not appear to use rotation-prism")
    return text


def main() -> int:
    args = parse_args()
    client = PiRpcClient(
        command=shlex.split(args.agent_command),
        cwd=args.workspace_dir.expanduser().resolve(),
        env=build_agent_env(args),
        request_timeout_seconds=args.request_timeout_seconds,
    )
    client.start()
    try:
        state = client.request("get_state")
        commands = extract_rpc_commands(client.request("get_commands"))
        if not has_skill_command(commands, "rotation-prism"):
            raise AgentSmokeError("agent runtime did not discover skill:rotation-prism")
        result: dict[str, Any] = {
            "ok": True,
            "skill": "rotation-prism",
            "state": state,
            "discovered": True,
            "runPrompt": args.run_prompt,
        }
        if args.run_prompt:
            result["assistantText"] = run_prompt(client, args)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    finally:
        client.close()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except AgentSmokeError as error:
        print(
            json.dumps(
                {"ok": False, "error": str(error)}, ensure_ascii=False, indent=2
            ),
            file=sys.stderr,
        )
        raise SystemExit(1)
