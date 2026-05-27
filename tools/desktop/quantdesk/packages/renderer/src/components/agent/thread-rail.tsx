import { memo } from 'react';

import { Button } from '../button';
import { useOverlayFocusTrap } from '../use-overlay-focus-trap';
import { ConversationHistoryPanelContent, type ConversationHistoryPanelItem } from './conversation-history-panel-content';

type ThreadRailConversation = ConversationHistoryPanelItem;

interface ThreadRailProps {
    activeConversationId: string | null;
    allowDelete?: boolean;
    collapsed: boolean;
    conversations: ThreadRailConversation[];
    drawer?: boolean;
    id?: string;
    isLoading: boolean;
    onClose?: () => void;
    onCreate: () => void;
    onDelete: (id: string) => void;
    onSelect: (id: string) => void;
    onToggleCollapsed?: () => void;
    open?: boolean;
}

export const ThreadRail = memo(({
    allowDelete = true,
    drawer = false,
    id,
    open = false,
    ...props
}: ThreadRailProps) => {
    const dialogRef = useOverlayFocusTrap<HTMLElement>(drawer && open, props.onClose);

    if (drawer) {
        if (!open) {
            return null;
        }

        return (
            <div
                aria-hidden="false"
                className="fixed inset-0 z-50 transition-[visibility] duration-300 lg:hidden visible pointer-events-auto"
            >
                <Button
                    aria-label="关闭线程抽屉"
                    className="absolute inset-0 bg-[rgba(23,19,16,0.42)] backdrop-blur-[2px] transition-opacity duration-300 opacity-100"
                    onClick={props.onClose}
                    size="sm"
                    tone="ghost"
                    type="button"
                >
                    <span className="sr-only">关闭线程抽屉</span>
                </Button>
                <aside
                    aria-label="会话目录"
                    aria-modal="true"
                    className="relative h-full w-full max-w-[360px] border-r border-[color:var(--color-border)] bg-[linear-gradient(180deg,var(--color-surface-strong),var(--color-surface))] shadow-[24px_0_80px_rgba(23,19,16,0.22)] backdrop-blur-xl transition-transform duration-300 ease-out translate-x-0"
                    id={id}
                    ref={dialogRef}
                    role="dialog"
                    tabIndex={-1}
                >
                    <ConversationHistoryPanelContent
                        {...props}
                        allowDelete={allowDelete}
                        createButtonTestId="agent-new-conversation"
                        listTestId="agent-thread-rail"
                        searchInputTestId="agent-thread-search"
                    />
                </aside>
            </div>
        );
    }

    return (
        <aside
            className={[
                'hidden h-full shrink-0 overflow-hidden rounded-[24px] border border-[color:var(--color-border)] bg-[linear-gradient(180deg,var(--color-surface-strong),var(--color-surface))] shadow-[0_22px_70px_rgba(23,19,16,0.16)] backdrop-blur-xl lg:block',
                props.collapsed ? 'w-[88px]' : 'w-[300px]',
            ].join(' ')}
            data-collapsed={props.collapsed ? '1' : '0'}
            id={id}
        >
            <ConversationHistoryPanelContent
                {...props}
                allowDelete={allowDelete}
                createButtonTestId="agent-new-conversation"
                listTestId="agent-thread-rail"
                searchInputTestId="agent-thread-search"
            />
        </aside>
    );
});

ThreadRail.displayName = 'ThreadRail';