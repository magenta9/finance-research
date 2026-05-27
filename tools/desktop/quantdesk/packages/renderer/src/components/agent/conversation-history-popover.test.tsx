// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import type { ComponentProps } from 'react';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';

import { ConversationHistoryPopover } from './conversation-history-popover';

const conversations = [
    {
        id: 'conversation-1',
        lastToolName: 'search_assets',
        status: 'running' as const,
        title: '宏观观察清单',
        updatedAt: '2026-04-21T13:02:00.000Z',
    },
    {
        id: 'conversation-2',
        lastToolName: 'analyze_asset',
        status: 'idle' as const,
        title: '资产诊断',
        updatedAt: '2026-04-22T09:00:00.000Z',
    },
];

const renderPopover = (overrides?: Partial<ComponentProps<typeof ConversationHistoryPopover>>) => {
    const anchor = document.createElement('button');
    anchor.textContent = '会话';
    document.body.appendChild(anchor);

    const anchorRef = { current: anchor };

    return render(
        <ConversationHistoryPopover
            activeConversationId="conversation-1"
            anchorRef={anchorRef}
            conversations={conversations}
            isLoading={false}
            onClose={vi.fn()}
            onCreateConversation={vi.fn()}
            onDeleteConversation={vi.fn()}
            onSelectConversation={vi.fn()}
            open
            {...overrides}
        />,
    );
};

describe('ConversationHistoryPopover', () => {
    test('renders as an accessible dialog and closes on Escape', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();

        renderPopover({ onClose });

        expect(screen.getByRole('dialog', { name: '会话历史' })).toBeInTheDocument();
        expect(screen.getByRole('searchbox', { name: '搜索会话' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '新建会话' })).not.toBeInTheDocument();

        await user.keyboard('{Escape}');

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    test('filters conversations and closes after selection', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        const onSelectConversation = vi.fn();

        renderPopover({ onClose, onSelectConversation });

        fireEvent.change(screen.getByRole('searchbox', { name: '搜索会话' }), {
            target: { value: '资产' },
        });

        await waitFor(() => {
            expect(screen.queryByRole('button', { name: '切换到会话 宏观观察清单' })).not.toBeInTheDocument();
        });
        await user.click(screen.getByRole('button', { name: '切换到会话 资产诊断' }));

        expect(onSelectConversation).toHaveBeenCalledWith('conversation-2');
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    test('closes on outside click', async () => {
        const onClose = vi.fn();

        renderPopover({ onClose });

        const outside = document.createElement('div');
        document.body.appendChild(outside);
        outside.dispatchEvent(new Event('pointerdown', { bubbles: true }));

        await waitFor(() => {
            expect(onClose).toHaveBeenCalledTimes(1);
        });
    });
});