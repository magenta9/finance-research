import { describe, expect, test } from 'vitest';

import { resolveLastToolName, resolveRunStatus, summarizeUnknown } from './session-run-status';
import type { PiWrapperSessionTranscript, PiToolInvocation } from './types';

const transcript: PiWrapperSessionTranscript = {
  cwd: '/workspace',
  messages: [
    { content: 'hello', id: 'u1', role: 'user' },
    { content: 'failed', id: 'a1', isError: true, role: 'assistant' },
  ],
  model: null,
  path: '/workspace/session.jsonl',
  sessionId: 'session-1',
  thinkingLevel: 'off',
};

describe('session run status helpers', () => {
  test('prefers live run status when available', () => {
    const status = resolveRunStatus('session-1', '2026-04-27T00:00:00.000Z', {
      currentTool: 'market.scan',
      degraded: false,
      degradedReason: null,
      lastError: null,
      runId: 'run-1',
      sessionId: 'session-1',
      state: 'running',
      updatedAt: '2026-04-27T00:00:01.000Z',
    });

    expect(status).toMatchObject({
      currentTool: 'market.scan',
      runId: 'run-1',
      state: 'running',
      updatedAt: '2026-04-27T00:00:01.000Z',
    });
  });

  test('infers persisted failure from an errored transcript', () => {
    const status = resolveRunStatus('session-1', '2026-04-27T00:00:00.000Z', null, transcript, []);

    expect(status).toMatchObject({
      lastError: 'failed',
      state: 'failed',
    });
  });

  test('resolves last tool name and unknown summaries', () => {
    const invocation = {
      toolName: 'get_asset_pool_summary',
    } as PiToolInvocation;

    expect(resolveLastToolName({ currentTool: null } as never, [invocation])).toBe('get_asset_pool_summary');
    expect(summarizeUnknown({ summary: 'done' })).toBe('done');
  });
});
