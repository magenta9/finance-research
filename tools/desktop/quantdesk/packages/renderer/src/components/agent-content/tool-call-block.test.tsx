// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test } from 'vitest';

import { AgentToolCallBlock } from './tool-call-block';

describe('AgentToolCallBlock', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    test('keeps active tool calls expanded while processing and collapses after completion', () => {
        const baseBlock = {
            id: 'tool-1',
            input: { symbol: '510300.SH' },
            toolLabel: 'get_asset_snapshot',
            toolName: 'get_asset_snapshot',
            type: 'tool_call',
        } as const;

        const { rerender } = render(
            <AgentToolCallBlock
                block={{
                    ...baseBlock,
                    status: 'running',
                }}
                threadId="thread-1"
            />,
        );

        expect(screen.getByTestId('content-block-tool-1')).toHaveTextContent('Input');
        expect(screen.getByTestId('content-block-tool-1')).toHaveTextContent('510300.SH');
        expect(screen.getByText('进行中')).toBeInTheDocument();

        rerender(
            <AgentToolCallBlock
                block={{
                    ...baseBlock,
                    output: {
                        content: '完成扫描。',
                        summary: '完成扫描。',
                    },
                    status: 'complete',
                }}
                threadId="thread-1"
            />,
        );

        expect(screen.getByTestId('content-block-tool-1')).toHaveTextContent('完成');
        expect(screen.getByTestId('content-block-tool-1')).not.toHaveTextContent('Input');
    });
});