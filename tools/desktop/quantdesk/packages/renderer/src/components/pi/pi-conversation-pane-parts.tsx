import { memo, useEffect, useMemo, useState } from 'react';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type { ConversationTimelineItem, PiWorkUnit } from '@quantdesk/shared';

import { AssistantMessageCard } from '../agent-content/assistant-message-card';
import { Button } from '../button';
import {
    derivePiTimelineRows,
    derivePiWorkUnitPresentation,
    getVisiblePiWorkItems,
    isPiWorkUnitOpenByDefault,
    MAX_VISIBLE_PI_WORK_LOG_ENTRIES,
    type PiTimelineRow,
} from './pi-message-timeline.logic';
import { formatTimestamp } from './pi-conversation-utils';

export { PiComposer } from './pi-composer';

interface PiMessageListProps {
    isLoadingSession: boolean;
    isSending: boolean;
    onStop: () => void;
    quickActions?: { key: string; label: string; description: string; onClick: () => void }[];
    threadId: string;
    timeline: ConversationTimelineItem[];
}

const roleLabelMap: Record<string, string> = {
    assistant: '回答',
    system: '提示',
    tool: '工具',
    user: '提问',
};

type WorkGroupRow = Extract<PiTimelineRow, { kind: 'work_group' }>;
type ToolWorkUnit = Extract<PiWorkUnit, { kind: 'tool_call' }>;

const isSafeStructuredImageUrl = (value: string) => {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'blob:';
    } catch (error) {
        if (error instanceof TypeError) {
            return false;
        }

        throw error;
    }
};

const renderStructuredOutput = (workUnit: ToolWorkUnit) => {
    const structured = workUnit.output?.structured;

    if (!structured) {
        return null;
    }

    if (structured.type === 'terminal') {
        return (
            <pre className="overflow-x-auto rounded-lg bg-[#2b2119] p-3 text-xs leading-6 text-[#f7efe3]">
                {structured.lines.map((line) => line.text).join('\n')}
            </pre>
        );
    }

    if (structured.type === 'diff') {
        return (
            <div className="space-y-2">
                {structured.files.map((file) => (
                    <article className="rounded-lg border border-[color:var(--color-border)] bg-[rgba(255,255,255,0.52)] p-3" key={file.path}>
                        <p className="font-mono text-[11px] text-[var(--color-muted)]">{file.path}</p>
                        {file.patch && <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs leading-6 text-[var(--color-copy)]">{file.patch}</pre>}
                    </article>
                ))}
            </div>
        );
    }

    if (structured.type === 'search_results') {
        return (
            <div className="space-y-2">
                {structured.results.map((result) => (
                    <article className="rounded-lg border border-[color:var(--color-border)] bg-[rgba(255,255,255,0.52)] p-3" key={`${result.path}-${result.title ?? ''}`}>
                        <p className="font-medium text-[var(--color-foreground)]">{result.title ?? result.path}</p>
                        {result.snippet && <p className="mt-1 text-xs leading-5 text-[var(--color-copy)]">{result.snippet}</p>}
                    </article>
                ))}
            </div>
        );
    }

    if (!isSafeStructuredImageUrl(structured.url)) {
        return <p className="text-xs leading-5 text-[var(--color-muted)]">图片地址不可预览</p>;
    }

    return (
        <figure className="overflow-hidden rounded-lg border border-[color:var(--color-border)] bg-[rgba(255,255,255,0.52)] p-3">
            <img alt={structured.alt ?? workUnit.toolLabel} className="max-h-[320px] w-full rounded-md object-cover" src={structured.url} />
            {structured.alt && <figcaption className="mt-2 text-xs leading-5 text-[var(--color-copy)]">{structured.alt}</figcaption>}
        </figure>
    );
};

const TimelineMessageBubble = ({ message }: { message: Extract<ConversationTimelineItem, { kind: 'message' }> }) => {
    const isUser = message.role === 'user';

    return (
        <div className={isUser ? 'flex justify-end' : 'flex justify-start'}>
        <article
            className={[
                'max-w-[82%] rounded-2xl border px-4 py-3',
                isUser
                    ? 'rounded-br-sm border-[rgba(156,98,55,0.18)] bg-[rgba(156,98,55,0.1)]'
                    : 'rounded-bl-sm border-[rgba(70,53,43,0.1)] bg-[rgba(255,255,255,0.36)]',
            ].join(' ')}
        >
            <div className="pi-chat-markdown pi-chat-markdown-message">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {message.content}
                </ReactMarkdown>
            </div>
            <div className={['mt-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-muted)]', isUser ? 'justify-end' : 'justify-start'].join(' ')}>
                {!isUser && <span>{roleLabelMap[message.role] ?? message.role}</span>}
                {message.createdAt && <span>{formatTimestamp(message.createdAt)}</span>}
            </div>
        </article>
    </div>
    );
};

const PiWorkUnitDetails = ({ workUnit }: { workUnit: PiWorkUnit }) => {
    if (workUnit.kind === 'reasoning') {
        return (
            <div className="pi-work-row-detail">
                <pre className="whitespace-pre-wrap break-words text-sm leading-6 text-[var(--color-copy)]">{workUnit.content}</pre>
            </div>
        );
    }

    const outputContent = workUnit.output?.content ?? null;
    const structuredOutput = renderStructuredOutput(workUnit);

    return (
        <div className="pi-work-row-detail space-y-3">
            <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-muted)]">Input</p>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg bg-[rgba(61,43,31,0.06)] p-3 text-xs leading-6 text-[var(--color-copy)]">{JSON.stringify(workUnit.input, null, 2)}</pre>
            </div>

            {(workUnit.output || workUnit.errorMessage) && (
                <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-muted)]">Output</p>
                    {workUnit.errorMessage && <p className="mt-2 text-sm leading-6 text-[#7d2c22]">{workUnit.errorMessage}</p>}
                    {workUnit.status === 'running' && outputContent && (
                        <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-muted)]">中间结果</p>
                    )}
                    {outputContent && <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg bg-[rgba(255,255,255,0.58)] p-3 text-xs leading-6 text-[var(--color-copy)]">{outputContent}</pre>}
                    {structuredOutput && <div className="mt-3">{structuredOutput}</div>}
                </div>
            )}
        </div>
    );
};

const PiWorkEntryRow = ({
    isOpen,
    onToggle,
    workUnit,
}: {
    isOpen: boolean;
    onToggle: () => void;
    workUnit: PiWorkUnit;
}) => {
    const presentation = derivePiWorkUnitPresentation(workUnit);

    return (
        <div className="pi-work-row" data-testid={`content-block-${workUnit.id}`}>
            <Button aria-expanded={isOpen} className="pi-work-row-button !h-auto !border-transparent !bg-transparent !p-1 !font-normal !shadow-none active:!scale-100" onClick={onToggle} size="sm" tone="ghost" type="button">
                <span aria-hidden="true" className={`pi-work-row-marker pi-work-row-marker-${presentation.tone}`} />
                <span className="min-w-0 flex-1 truncate text-left text-xs leading-5">
                    <span className="font-medium text-[var(--color-foreground)]">{presentation.heading}</span>
                    {presentation.preview && (
                        <>
                            <span className="text-[var(--color-muted)]" aria-hidden="true">{' - '}</span>
                            <span className="text-[var(--color-muted)]">{presentation.preview}</span>
                        </>
                    )}
                </span>
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-muted)]">{presentation.statusLabel}</span>
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-muted)]">{isOpen ? '收起' : '展开'}</span>
            </Button>
            {isOpen && <PiWorkUnitDetails workUnit={workUnit} />}
        </div>
    );
};

const PiWorkGroupSection = ({
    getWorkUnitOpen,
    isExpanded,
    onToggleExpanded,
    onToggleWorkUnit,
    row,
}: {
    getWorkUnitOpen: (workUnit: PiWorkUnit) => boolean;
    isExpanded: boolean;
    onToggleExpanded: () => void;
    onToggleWorkUnit: (workUnit: PiWorkUnit) => void;
    row: WorkGroupRow;
}) => {
    const hasOverflow = row.items.length > MAX_VISIBLE_PI_WORK_LOG_ENTRIES;
    const visibleItems = getVisiblePiWorkItems(row, isExpanded);
    const hiddenCount = row.items.length - visibleItems.length;
    const onlyToolEntries = row.items.every((item) => item.workUnit.kind === 'tool_call');
    const showHeader = hasOverflow || !onlyToolEntries;
    const groupLabel = onlyToolEntries ? 'Tool calls' : 'Work log';

    return (
        <section className="pi-work-group">
            {showHeader && (
                <div className="mb-1.5 flex items-center justify-between gap-2 px-0.5">
                    <p className="text-[9px] uppercase tracking-[0.16em] text-[var(--color-muted)]">
                        {groupLabel} ({row.items.length})
                    </p>
                    {hasOverflow && (
                        <Button className="!h-auto !rounded-md !border-transparent !bg-transparent !px-1 !py-0 !text-[9px] !font-normal uppercase tracking-[0.12em] !text-[var(--color-muted)] !shadow-none hover:!text-[var(--color-foreground)] active:!scale-100" onClick={onToggleExpanded} size="sm" tone="ghost" type="button">
                            {isExpanded ? 'Show less' : `Show ${hiddenCount} more`}
                        </Button>
                    )}
                </div>
            )}
            <div className="space-y-0.5">
                {visibleItems.map((item) => (
                    <PiWorkEntryRow
                        isOpen={getWorkUnitOpen(item.workUnit)}
                        key={item.id}
                        onToggle={() => { onToggleWorkUnit(item.workUnit); }}
                        workUnit={item.workUnit}
                    />
                ))}
            </div>
        </section>
    );
};

export const PiMessageList = memo(({
    isLoadingSession,
    isSending,
    onStop,
    quickActions,
    threadId,
    timeline,
}: PiMessageListProps) => {
    const rows = useMemo(() => derivePiTimelineRows(timeline), [timeline]);
    const [workGroupExpandedState, setWorkGroupExpandedState] = useState<Record<string, boolean>>({});
    const [workUnitOpenState, setWorkUnitOpenState] = useState<Record<string, boolean>>({});

    useEffect(() => {
        setWorkGroupExpandedState({});
        setWorkUnitOpenState({});
    }, [threadId]);

    if (isLoadingSession) {
        return (
            <div className="rounded-[16px] border border-dashed border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-4 text-sm text-[var(--color-copy)]">
                正在载入 Pi 会话详情...
            </div>
        );
    }

    if (timeline.length === 0) {
        return (
            <div className="rounded-[20px] border border-dashed border-[color:var(--color-border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] px-5 py-6 text-center">
                <div className="mx-auto w-full max-w-[min(100%,72rem)]">
                    <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-muted)]">Ready</p>
                    <h3 className="mt-2 text-[1.4rem] font-semibold leading-tight text-[var(--color-foreground)]">从一个本地任务开始</h3>
                    <p className="mt-2 text-sm leading-6 text-[var(--color-copy)]">先写任务，再看结果。</p>
                    {quickActions && quickActions.length > 0 && (
                        <div className="mt-5 flex flex-wrap gap-2 text-left">
                            {quickActions.map((action) => (
                                <Button
                                    className="h-auto min-w-[180px] flex-1 justify-start rounded-[14px] border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-3.5 py-3 text-left shadow-none hover:border-[rgba(255,255,255,0.14)] hover:bg-[rgba(255,255,255,0.05)]"
                                    key={action.key}
                                    onClick={action.onClick}
                                    size="sm"
                                    tone="ghost"
                                    type="button"
                                >
                                    <span className="block text-[13px] font-semibold text-[var(--color-foreground)]">{action.label}</span>
                                    <span className="mt-1 block text-xs leading-5 text-[var(--color-copy)]">{action.description}</span>
                                </Button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    const getWorkGroupExpanded = (row: WorkGroupRow) => {
        const stateKey = `${threadId}:${row.id}`;
        return workGroupExpandedState[stateKey] ?? false;
    };

    const toggleWorkGroupExpanded = (row: WorkGroupRow) => {
        const stateKey = `${threadId}:${row.id}`;
        setWorkGroupExpandedState((current) => ({
            ...current,
            [stateKey]: !(current[stateKey] ?? false),
        }));
    };

    const getWorkUnitOpen = (workUnit: PiWorkUnit) => {
        const stateKey = `${threadId}:${workUnit.id}`;
        return workUnitOpenState[stateKey] ?? isPiWorkUnitOpenByDefault(workUnit);
    };

    const toggleWorkUnitOpen = (workUnit: PiWorkUnit) => {
        const stateKey = `${threadId}:${workUnit.id}`;
        setWorkUnitOpenState((current) => ({
            ...current,
            [stateKey]: !(current[stateKey] ?? isPiWorkUnitOpenByDefault(workUnit)),
        }));
    };

    return (
        <div className="space-y-4 overflow-x-hidden">
            {rows.map((row) => (
                <div className="mx-auto w-full min-w-0 max-w-[min(100%,72rem)] overflow-x-hidden" data-pi-timeline-row-id={row.id} data-pi-timeline-row-kind={row.kind} key={row.id}>
                    {row.kind === 'assistant_message' ? (
                        <AssistantMessageCard
                            assistantMessage={row.item.assistantMessage}
                            onStop={isSending && row.item.assistantMessage.status === 'streaming' ? () => { onStop(); } : undefined}
                            threadId={threadId}
                        />
                    ) : row.kind === 'work_group' ? (
                        <PiWorkGroupSection
                            getWorkUnitOpen={getWorkUnitOpen}
                            isExpanded={getWorkGroupExpanded(row)}
                            onToggleExpanded={() => { toggleWorkGroupExpanded(row); }}
                            onToggleWorkUnit={toggleWorkUnitOpen}
                            row={row}
                        />
                    ) : (
                        <TimelineMessageBubble message={row.item} />
                    )}
                </div>
            ))}
        </div>
    );
});

PiMessageList.displayName = 'PiMessageList';
