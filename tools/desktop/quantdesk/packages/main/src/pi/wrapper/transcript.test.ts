import { describe, expect, test } from 'vitest';

import {
  getPiTranscriptFailureMessage,
  normalizePiTranscriptMessages,
  QUANTDESK_ATTACHMENT_CONTEXT_END,
  QUANTDESK_ATTACHMENT_CONTEXT_START,
} from './transcript';

describe('normalizePiTranscriptMessages', () => {
  test('surfaces assistant errorMessage when the upstream content array is empty', () => {
    const messages = normalizePiTranscriptMessages('session-1', [{
      id: 'assistant-1',
      message: {
        content: [],
        role: 'assistant',
      },
      stopReason: 'error',
      errorMessage: '400 bad request',
    }]);

    expect(messages).toEqual([expect.objectContaining({
      content: '400 bad request',
      id: 'assistant-1',
      isError: true,
      role: 'assistant',
    })]);
  });

  test('splits mixed assistant content into thinking and answer while omitting tool placeholders', () => {
    const messages = normalizePiTranscriptMessages('session-1', [{
      id: 'assistant-1',
      message: {
        content: [
          { thinking: '先确认官方来源。', type: 'thinking' },
          { arguments: { path: '/tmp/source.md' }, name: 'read', type: 'toolCall' },
          { text: '找到公告链接，继续收集评价。', type: 'text' },
        ],
        role: 'assistant',
      },
    }]);

    expect(messages).toEqual([
      expect.objectContaining({
        content: '先确认官方来源。',
        id: 'assistant-1',
        phase: 'thinking',
        role: 'assistant',
      }),
      expect.objectContaining({
        content: '找到公告链接，继续收集评价。',
        id: 'assistant-1',
        phase: 'assistant',
        role: 'assistant',
      }),
    ]);
  });

  test('drops assistant snapshots that only contain tool calls', () => {
    const messages = normalizePiTranscriptMessages('session-1', [{
      id: 'assistant-1',
      message: {
        content: [
          { arguments: { command: 'echo hello' }, name: 'bash', type: 'toolCall' },
        ],
        role: 'assistant',
      },
    }]);

    expect(messages).toEqual([]);
  });

  test('coalesces duplicate assistant snapshots by id and phase', () => {
    const messages = normalizePiTranscriptMessages('session-1', [
      {
        content: [{ text: '检查组合风险', type: 'text' }],
        id: 'user-1',
        role: 'user',
      },
      {
        content: [{ text: '先看持仓。', type: 'text' }],
        id: 'assistant-1',
        phase: 'thinking',
        role: 'assistant',
      },
      {
        content: [{ text: '先看持仓和回撤。', type: 'text' }],
        id: 'assistant-1',
        phase: 'thinking',
        role: 'assistant',
      },
      {
        content: [{ text: '组合当前波动偏高。', type: 'text' }],
        id: 'assistant-1',
        phase: 'assistant',
        role: 'assistant',
      },
      {
        content: [{ text: '组合当前波动偏高，建议先降杠杆。', type: 'text' }],
        id: 'assistant-1',
        phase: 'assistant',
        role: 'assistant',
      },
    ]);

    expect(messages).toEqual([
      expect.objectContaining({
        content: '检查组合风险',
        id: 'user-1',
        role: 'user',
      }),
      expect.objectContaining({
        content: '先看持仓和回撤。',
        id: 'assistant-1',
        phase: 'thinking',
        role: 'assistant',
      }),
      expect.objectContaining({
        content: '组合当前波动偏高，建议先降杠杆。',
        id: 'assistant-1',
        phase: 'assistant',
        role: 'assistant',
      }),
    ]);
  });

  test('strips injected QuantDesk attachment context from visible user messages', () => {
    const messages = normalizePiTranscriptMessages('session-1', [{
      content: [
        {
          text: [
            '分析这些附件',
            QUANTDESK_ATTACHMENT_CONTEXT_START,
            'QuantDesk attachments:',
            '- Document: notes.md',
            'secret attachment body',
            QUANTDESK_ATTACHMENT_CONTEXT_END,
          ].join('\n'),
          type: 'text',
        },
      ],
      id: 'user-1',
      role: 'user',
    }]);

    expect(messages).toEqual([expect.objectContaining({
      content: '分析这些附件',
      id: 'user-1',
      role: 'user',
    })]);
  });
});

describe('getPiTranscriptFailureMessage', () => {
  test('returns the latest transcript error message', () => {
    expect(getPiTranscriptFailureMessage({
      cwd: '/tmp/workspace',
      messages: [
        { content: 'hello', id: 'user-1', role: 'user' },
        { content: '400 bad request', id: 'assistant-1', isError: true, role: 'assistant' },
      ],
      model: null,
      path: '/tmp/session.jsonl',
      sessionId: 'session-1',
      thinkingLevel: 'off',
    })).toBe('400 bad request');
  });

  test('ignores earlier tool errors when the final assistant message succeeded', () => {
    expect(getPiTranscriptFailureMessage({
      cwd: '/tmp/workspace',
      messages: [
        { content: '查一下本周新闻', id: 'user-1', role: 'user' },
        { content: 'JSONDecodeError: Expecting value', id: 'tool-1', isError: true, role: 'toolResult' },
        { content: '已经改用 RSS 源完成汇总。', id: 'assistant-1', role: 'assistant' },
      ],
      model: null,
      path: '/tmp/session.jsonl',
      sessionId: 'session-1',
      thinkingLevel: 'off',
    })).toBeNull();
  });
});
