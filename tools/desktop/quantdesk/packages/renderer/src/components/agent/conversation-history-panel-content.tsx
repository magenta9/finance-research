import { useMemo, useState } from 'react';

import type {
    AgentConversationSummary,
    PiRunState,
    PiSessionSummary,
} from '@quantdesk/shared';

import { Button } from '../button';
import { SearchInput } from '../search-input';

export interface ConversationHistoryPanelItem {
    id: AgentConversationSummary['id'];
    lastError?: string | null;
    lastToolName?: AgentConversationSummary['lastToolName'];
    status?: AgentConversationSummary['status'] | PiRunState;
    title: AgentConversationSummary['title'];
    titleStatus?: AgentConversationSummary['titleStatus'] | PiSessionSummary['titleStatus'];
    updatedAt: AgentConversationSummary['updatedAt'];
}

interface ConversationHistoryPanelContentProps {
    activeConversationId: string | null;
    allowDelete?: boolean;
    collapsed?: boolean;
    conversations: ConversationHistoryPanelItem[];
    createButtonLabel?: string;
    createButtonTestId?: string;
    description?: string;
    eyebrow?: string;
    isLoading: boolean;
    showCreateButton?: boolean;
    listTestId: string;
    onClose?: () => void;
    onCreate: () => void;
    onDelete: (id: string) => void;
    onSelect: (id: string) => void;
    onToggleCollapsed?: () => void;
    searchInputTestId: string;
    title?: string;
}

const runStateLabel: Record<string, string> = {
    failed: '失败',
    cancelled: '已取消',
    idle: '空闲',
    running: '运行中',
    waiting: '等待',
};

const formatTimestamp = (value: string | null | undefined) => (
    value ? value.slice(5, 16).replace('T', ' ') : '刚刚'
);

const formatCardDate = (value: string | null | undefined) => ({
    day: value ? value.slice(8, 10) : '--',
    month: value ? `${value.slice(5, 7)}月` : 'NOW',
});

const formatConversationShortLabel = (title: string | null | undefined) => {
    const normalizedTitle = (title || '会').trim();
    return (normalizedTitle.slice(0, 1) || '会').toUpperCase();
};

const statusDotClass = (state?: string) => {
    if (state === 'failed') {
        return 'h-2 w-2 rounded-full bg-[#c56d58]';
    }

    if (state === 'running') {
        return 'h-2 w-2 rounded-full bg-[var(--color-highlight)]';
    }

    if (state === 'cancelled') {
        return 'h-2 w-2 rounded-full bg-[color:var(--color-muted)] opacity-60';
    }

    return 'h-2 w-2 rounded-full bg-[color:var(--color-muted)] opacity-35';
};

const resolveSecondaryLabel = (conversation: ConversationHistoryPanelItem) => {
    if (conversation.lastError) {
        return conversation.lastError;
    }

    if (conversation.status === 'failed') {
        return '上次停在失败';
    }

    if (conversation.titleStatus === 'pending') {
        return '主题生成中';
    }

    if (conversation.titleStatus === 'failed') {
        return '主题生成失败';
    }

    if (conversation.lastToolName) {
        return `最近动作 · ${conversation.lastToolName}`;
    }

    return '继续这条线索';
};

const historyCardClassName = 'relative rounded-[18px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] font-medium text-[var(--color-copy)] shadow-[0_10px_30px_rgba(23,19,16,0.08)] transition-[transform,border-color,background-color,color,box-shadow] duration-200 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(197,138,77,0.32)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent hover:border-[var(--color-highlight-soft)] hover:bg-[color:var(--color-surface-strong)] hover:text-[var(--color-foreground)]';

const historyCardActiveClassName = 'border-[var(--color-highlight-soft)] bg-[color:var(--color-surface-strong)] text-[var(--color-foreground)] ring-1 ring-inset ring-[var(--color-highlight-soft)] shadow-[0_16px_36px_rgba(23,19,16,0.16)]';

const historyDateBadgeClassName = 'flex h-[52px] w-[50px] shrink-0 flex-col items-center justify-center rounded-[14px] border border-[var(--color-highlight-soft)] bg-[color:var(--color-surface-strong)] text-[var(--color-foreground)] shadow-[0_8px_24px_rgba(23,19,16,0.12)]';

export const ConversationHistoryPanelContent = ({
    activeConversationId,
    allowDelete = true,
    collapsed = false,
    conversations,
    createButtonLabel = '新建会话',
    createButtonTestId,
    description = '保留过程线索，但不抢正文层级。',
    eyebrow = 'history',
    isLoading,
    showCreateButton = true,
    listTestId,
    onClose,
    onCreate,
    onDelete,
    onSelect,
    onToggleCollapsed,
    searchInputTestId,
    title = '会话',
}: ConversationHistoryPanelContentProps) => {
    const [query, setQuery] = useState('');
    const filteredConversations = useMemo(
        () => conversations.filter((conversation) => {
            const haystack = `${conversation.title ?? ''} ${conversation.lastToolName ?? ''}`.toLowerCase();
            return haystack.includes(query.trim().toLowerCase());
        }),
        [conversations, query],
    );

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="border-b border-[color:var(--color-border)] p-4">
                <div className="flex items-start justify-between gap-3">
                    {!collapsed && (
                        <div>
                            {eyebrow && <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-[var(--color-muted)]">{eyebrow}</p>}
                            <div className="mt-2 flex items-end gap-3">
                                <h2 className="text-[1.05rem] font-semibold leading-none text-[var(--color-foreground)]">{title}</h2>
                                <span className="font-mono pb-0.5 text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted)]">{conversations.length}</span>
                            </div>
                            {description && <p className="mt-2 max-w-[18rem] text-sm leading-6 text-[var(--color-copy)]">{description}</p>}
                        </div>
                    )}
                    <div className="flex items-center gap-2">
                        {onToggleCollapsed && (
                            <Button
                                aria-label={collapsed ? '展开历史目录' : '收起历史目录'}
                                className="h-8 w-8 rounded-[10px] px-0"
                                data-testid="agent-history-overlay-toggle"
                                onClick={onToggleCollapsed}
                                size="sm"
                                tone="ghost"
                                type="button"
                            >
                                {collapsed ? '›' : '‹'}
                            </Button>
                        )}
                        {onClose && (
                            <Button
                                aria-label="关闭会话目录"
                                className="h-8 w-8 rounded-[10px] px-0"
                                onClick={onClose}
                                size="sm"
                                tone="ghost"
                                type="button"
                            >
                                ×
                            </Button>
                        )}
                    </div>
                </div>

                {showCreateButton && (
                    <Button
                        className={collapsed ? 'mt-4 h-10 w-full rounded-[12px] px-0' : 'mt-4 w-full justify-center rounded-[12px]'}
                        data-testid={createButtonTestId}
                        onClick={() => {
                            onCreate();
                            onClose?.();
                        }}
                        tone="primary"
                        type="button"
                    >
                        {collapsed ? '+' : createButtonLabel}
                    </Button>
                )}

                {!collapsed && (
                    <div className="mt-4">
                        <SearchInput
                            aria-label="搜索会话"
                            className="rounded-[16px] border-[var(--color-highlight-soft)] bg-[color:var(--color-surface-strong)] shadow-[0_12px_28px_rgba(23,19,16,0.12)]"
                            data-testid={searchInputTestId}
                            onChange={setQuery}
                            placeholder="搜标题或最近动作"
                            value={query}
                        />
                    </div>
                )}
            </div>

            <div className="flex-1 overflow-y-auto p-3.5" data-agent-scroll="1" data-collapsed={collapsed ? '1' : '0'} data-testid={listTestId}>
                {isLoading ? (
                    <div className="rounded-[16px] border border-dashed border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-4 text-sm text-[var(--color-copy)]">
                        正在载入线程列表...
                    </div>
                ) : filteredConversations.length === 0 ? (
                    <div className="rounded-[16px] border border-dashed border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-4 text-sm text-[var(--color-copy)]">
                        没找到对应会话。
                    </div>
                ) : (
                    <div className="space-y-2.5">
                        {filteredConversations.map((conversation) => {
                            const isActive = conversation.id === activeConversationId;
                            const dateLabel = formatCardDate(conversation.updatedAt);
                            const statusLabel = conversation.status
                                ? (runStateLabel[conversation.status] ?? conversation.status)
                                : '空闲';
                            const secondaryLabel = resolveSecondaryLabel(conversation);

                            return (
                                <article
                                    className={[
                                        'group relative transition duration-200',
                                        isActive ? 'z-[1]' : '',
                                    ].join(' ')}
                                    data-testid={`conversation-history-item-${conversation.id}`}
                                    key={conversation.id}
                                >
                                    {!collapsed && allowDelete && (
                                        <Button
                                            aria-label={`删除${conversation.title || '会话'}`}
                                            className="absolute right-2.5 top-2.5 z-[2] h-7 w-7 rounded-[10px] px-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                                            onClick={() => {
                                                onDelete(conversation.id);
                                            }}
                                            size="sm"
                                            tone="ghost"
                                            type="button"
                                        >
                                            ×
                                        </Button>
                                    )}

                                    <div className="flex items-start gap-3">
                                        <Button
                                            aria-label={`切换到会话 ${conversation.title || '未命名对话'}`}
                                            aria-pressed={isActive}
                                            className={[
                                                historyCardClassName,
                                                isActive ? historyCardActiveClassName : '',
                                                collapsed
                                                    ? 'flex h-auto min-h-[78px] w-full items-center justify-center p-3'
                                                    : 'flex h-auto min-h-[104px] w-full min-w-0 items-start gap-3 p-3.5 pr-10 text-left',
                                            ].join(' ')}
                                            data-testid={`conversation-history-select-${conversation.id}`}
                                            onClick={() => {
                                                onSelect(conversation.id);
                                                onClose?.();
                                            }}
                                            size="none"
                                            type="button"
                                        >
                                            <span className={historyDateBadgeClassName}>
                                                <span className="font-mono text-[9px] uppercase tracking-[0.24em] text-[var(--color-muted)]">{collapsed ? '会话' : dateLabel.month}</span>
                                                <span className="mt-1 text-[1.1rem] font-semibold leading-none">{collapsed ? formatConversationShortLabel(conversation.title) : dateLabel.day}</span>
                                            </span>
                                            {!collapsed && (
                                                <span className="min-w-0 flex-1 pt-0.5">
                                                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
                                                        <span className={statusDotClass(conversation.status)} />
                                                        <span>{statusLabel}</span>
                                                        <span>{formatTimestamp(conversation.updatedAt)}</span>
                                                    </span>
                                                    <span className="mt-1.5 block whitespace-normal text-pretty text-[0.98rem] font-semibold leading-[1.28] text-[var(--color-foreground)]">
                                                        {conversation.title || '未命名对话'}
                                                    </span>
                                                    <span className={[
                                                        'mt-1.5 block text-xs leading-5',
                                                        conversation.status === 'failed' ? 'text-[#c56d58]' : 'text-[var(--color-muted)]',
                                                    ].join(' ')}>
                                                        {secondaryLabel}
                                                    </span>
                                                </span>
                                            )}
                                        </Button>
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};