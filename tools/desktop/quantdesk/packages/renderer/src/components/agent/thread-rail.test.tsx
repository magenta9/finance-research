// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';

import { ThreadRail } from './thread-rail';

const conversation = {
    id: 'conversation-1',
    lastToolName: 'search_assets',
    status: 'running' as const,
    title: '宏观观察清单',
    updatedAt: '2026-04-21T13:02:00.000Z',
};

describe('ThreadRail', () => {
    test('renders the drawer as an accessible dialog and closes on Escape', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();

        render(
            <ThreadRail
                activeConversationId="conversation-1"
                collapsed={false}
                conversations={[conversation]}
                drawer
                isLoading={false}
                onClose={onClose}
                onCreate={vi.fn()}
                onDelete={vi.fn()}
                onSelect={vi.fn()}
                open
            />,
        );

        expect(screen.getByRole('dialog', { name: '会话目录' })).toBeInTheDocument();
        expect(screen.getByRole('searchbox', { name: '搜索会话' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '切换到会话 宏观观察清单' })).toBeInTheDocument();

        await user.keyboard('{Escape}');

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    test('labels collapsed conversation buttons with the full title', () => {
        render(
            <ThreadRail
                activeConversationId={null}
                collapsed
                conversations={[conversation]}
                isLoading={false}
                onCreate={vi.fn()}
                onDelete={vi.fn()}
                onSelect={vi.fn()}
            />,
        );

        expect(screen.getByRole('button', { name: '切换到会话 宏观观察清单' })).toBeInTheDocument();
        expect(screen.getByText('宏')).toBeInTheDocument();
    });

    test('lets expanded conversation cards grow with their content', () => {
        render(
            <ThreadRail
                activeConversationId={null}
                collapsed={false}
                conversations={[conversation]}
                isLoading={false}
                onCreate={vi.fn()}
                onDelete={vi.fn()}
                onSelect={vi.fn()}
            />,
        );

        const selector = screen.getByRole('button', { name: '切换到会话 宏观观察清单' });

        expect(selector.className).toContain('h-auto');
        expect(selector.className).toContain('min-h-[104px]');
        expect(selector.className).not.toContain('h-9');
        expect(selector.className).not.toContain('h-11');
    });
});