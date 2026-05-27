import { describe, expect, test } from 'vitest';

import { PiRunStatusStore } from './run-status-store';

describe('PiRunStatusStore', () => {
  test('projects run and tool stream events into live session status', () => {
    const store = new PiRunStatusStore();

    store.apply({
      message: 'hello',
      runId: 'run-1',
      sessionId: 'session-1',
      timestamp: '2026-04-27T00:00:00.000Z',
      type: 'run_started',
    });
    store.apply({
      args: {},
      runId: 'run-1',
      sessionId: 'session-1',
      timestamp: '2026-04-27T00:00:01.000Z',
      toolCallId: 'tool-1',
      toolName: 'get_asset_pool_summary',
      type: 'tool_execution_start',
    });

    expect(store.get('session-1')).toMatchObject({
      currentTool: 'get_asset_pool_summary',
      runId: 'run-1',
      state: 'running',
      updatedAt: '2026-04-27T00:00:01.000Z',
    });

    store.apply({
      runId: 'run-1',
      sessionId: 'session-1',
      timestamp: '2026-04-27T00:00:02.000Z',
      transcript: {
        cwd: '/workspace',
        messages: [],
        model: null,
        path: '/workspace/session.jsonl',
        sessionId: 'session-1',
        thinkingLevel: 'off',
      },
      type: 'run_completed',
    });

    expect(store.get('session-1')).toMatchObject({
      currentTool: null,
      lastError: null,
      state: 'idle',
    });
  });
});
