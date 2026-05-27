import { describe, expect, test } from 'vitest';

import { reduceNormalizedStreamEvents } from './assistant-content-store-helpers';

describe('reduceNormalizedStreamEvents', () => {
    test('closes the previous thinking block when a tool block starts', () => {
        const projection = reduceNormalizedStreamEvents(undefined, [
            {
                data: { messageId: 'assistant-1' },
                event: 'message_start',
            },
            {
                data: {
                    block: {
                        content: '',
                        id: 'thinking-1',
                        status: 'streaming',
                        type: 'thinking',
                    },
                    messageId: 'assistant-1',
                },
                event: 'block_start',
            },
            {
                data: {
                    blockId: 'thinking-1',
                    delta: {
                        text: '先读取当前市场快照。',
                        type: 'thinking_delta',
                    },
                    messageId: 'assistant-1',
                },
                event: 'block_delta',
            },
            {
                data: {
                    block: {
                        id: 'tool-1',
                        input: { symbol: '510300.SH' },
                        status: 'running',
                        toolLabel: 'get_asset_snapshot',
                        toolName: 'get_asset_snapshot',
                        type: 'tool_call',
                    },
                    messageId: 'assistant-1',
                },
                event: 'block_start',
            },
        ]);

        const blocks = projection.assistantMessages[0]?.blocks ?? [];

        expect(blocks[0]).toEqual(expect.objectContaining({
            id: 'thinking-1',
            status: 'complete',
            type: 'thinking',
        }));
        expect(blocks[1]).toEqual(expect.objectContaining({
            id: 'tool-1',
            status: 'running',
            type: 'tool_call',
        }));
    });

    test('completes the last streaming text block when the message ends', () => {
        const projection = reduceNormalizedStreamEvents(undefined, [
            {
                data: { messageId: 'assistant-1' },
                event: 'message_start',
            },
            {
                data: {
                    block: {
                        content: '',
                        id: 'text-1',
                        status: 'streaming',
                        type: 'text',
                    },
                    messageId: 'assistant-1',
                },
                event: 'block_start',
            },
            {
                data: {
                    blockId: 'text-1',
                    delta: {
                        text: '这是最终回答。',
                        type: 'text_delta',
                    },
                    messageId: 'assistant-1',
                },
                event: 'block_delta',
            },
            {
                data: {
                    messageId: 'assistant-1',
                    status: 'complete',
                },
                event: 'message_end',
            },
        ]);

        expect(projection.assistantMessages[0]?.blocks[0]).toEqual(expect.objectContaining({
            content: '这是最终回答。',
            status: 'complete',
            type: 'text',
        }));
    });

    test('does not close a streaming text block when an existing tool block is updated again', () => {
        const projection = reduceNormalizedStreamEvents(undefined, [
            {
                data: { messageId: 'assistant-1' },
                event: 'message_start',
            },
            {
                data: {
                    block: {
                        id: 'tool-1',
                        input: { symbol: '510300.SH' },
                        status: 'running',
                        toolLabel: 'get_asset_snapshot',
                        toolName: 'get_asset_snapshot',
                        type: 'tool_call',
                    },
                    messageId: 'assistant-1',
                },
                event: 'block_start',
            },
            {
                data: {
                    block: {
                        content: '',
                        id: 'text-1',
                        status: 'streaming',
                        type: 'text',
                    },
                    messageId: 'assistant-1',
                },
                event: 'block_start',
            },
            {
                data: {
                    blockId: 'text-1',
                    delta: {
                        text: '正在总结。',
                        type: 'text_delta',
                    },
                    messageId: 'assistant-1',
                },
                event: 'block_delta',
            },
            {
                data: {
                    block: {
                        id: 'tool-1',
                        input: { symbol: '510300.SH' },
                        status: 'complete',
                        toolLabel: 'get_asset_snapshot',
                        toolName: 'get_asset_snapshot',
                        type: 'tool_call',
                    },
                    messageId: 'assistant-1',
                },
                event: 'block_start',
            },
        ]);

        const blocks = projection.assistantMessages[0]?.blocks ?? [];

        expect(blocks.map((block) => block.id)).toEqual(['tool-1', 'text-1']);
        expect(blocks[1]).toEqual(expect.objectContaining({
            content: '正在总结。',
            status: 'streaming',
            type: 'text',
        }));
    });
});