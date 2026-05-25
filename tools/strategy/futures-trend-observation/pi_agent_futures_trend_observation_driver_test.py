#!/usr/bin/env python3

from __future__ import annotations

import queue
import unittest
from pathlib import Path

from pi_agent_futures_trend_observation_driver import (
    PiRpcClient,
    extract_rpc_commands,
    has_skill_command,
)
from pi_agent_futures_trend_observation_report import (
    assistant_value,
    grouped_summary_results,
)


class RecordingPiRpcClient(PiRpcClient):
    def __init__(self) -> None:
        super().__init__(
            command=[],
            cwd=Path.cwd(),
            env={},
            request_timeout_seconds=1,
        )
        self.written_messages: list[dict[str, object]] = []

    def _write(self, message: dict[str, object]) -> None:
        self.written_messages.append(message)


class PiRpcClientTest(unittest.TestCase):
    def test_rpc_response_routing(self) -> None:
        client = RecordingPiRpcClient()
        response_queue: queue.Queue[dict[str, object]] = queue.Queue(maxsize=1)
        client.pending["request-1"] = response_queue

        client._route_stdout_message(
            {
                "id": "request-1",
                "type": "response",
                "command": "get_commands",
                "success": True,
                "data": {"commands": []},
            }
        )

        self.assertEqual(response_queue.get_nowait()["command"], "get_commands")

    def test_assistant_text_accumulation_and_agent_end(self) -> None:
        client = RecordingPiRpcClient()
        client.events.put(
            {
                "type": "message_update",
                "assistantMessageEvent": {"type": "text_delta", "delta": "{"},
            }
        )
        client.events.put(
            {
                "type": "message_update",
                "assistantMessageEvent": {"type": "text_delta", "delta": "}\n"},
            }
        )
        client.events.put({"type": "agent_end", "messages": []})

        event = client.wait_for_agent_end("session-1", timeout_seconds=1)

        self.assertEqual(event["assistantText"], "{}")

    def test_extension_ui_request_cancellation_serialization(self) -> None:
        client = RecordingPiRpcClient()

        client._handle_extension_ui_request(
            {
                "type": "extension_ui_request",
                "id": "ui-1",
                "method": "confirm",
                "title": "Continue?",
                "message": "Need input",
            }
        )

        self.assertEqual(
            client.written_messages,
            [{"type": "extension_ui_response", "id": "ui-1", "cancelled": True}],
        )

    def test_skill_command_discovery_accepts_official_shape(self) -> None:
        commands = extract_rpc_commands(
            {
                "commands": [
                    {"name": "skill:futures-trend-observation", "source": "skill"},
                    {"name": "other", "source": "prompt"},
                ]
            }
        )

        self.assertTrue(has_skill_command(commands, "futures-trend-observation"))

    def test_report_consumes_rpc_result_shape(self) -> None:
        result = {
            "runType": "run_completed",
            "assistantJson": {
                "overallStatusLabel": "到达趋势观察位",
                "overall": {"directionLabel": "多头"},
            },
        }

        self.assertEqual(
            assistant_value(result, "overallStatusLabel"), "到达趋势观察位"
        )
        self.assertEqual(assistant_value(result, "overallDirectionLabel"), "多头")

    def test_report_summary_groups_consistency_then_sorts_direction_and_status(
        self,
    ) -> None:
        results = [
            self._summary_result("RB9999", "多空混杂", "空头", "到达趋势观察位"),
            self._summary_result("CF9999", "方向一致", "多头", "有趋势但未到观察位"),
            self._summary_result("M9999", "方向一致", "多头", "到达趋势观察位"),
            self._summary_result("LH9999", "方向一致", "空头", "到达趋势观察位"),
        ]

        grouped = grouped_summary_results(results)

        self.assertEqual([label for label, _items in grouped], ["方向一致", "多空混杂"])
        self.assertEqual(
            [item["symbol"] for item in grouped[0][1]],
            ["M9999", "CF9999", "LH9999"],
        )

    def _summary_result(
        self, symbol: str, consistency: str, direction: str, status: str
    ) -> dict[str, object]:
        return {
            "symbol": symbol,
            "assistantJson": {
                "directionConsistencyLabel": consistency,
                "overallDirectionLabel": direction,
                "overallStatusLabel": status,
            },
        }


if __name__ == "__main__":
    unittest.main()
