import { useEffect, useMemo, useRef, useState } from 'react';

import type {
    AssistantMessage,
    ConversationTimelineItem,
    PiWorkUnit,
    PiRiskGateState,
    PiRunStatus,
    PiSessionRecord,
    PiSkillSummary,
    PiStagedAttachment,
} from '@quantdesk/shared';

import { Badge } from '../badge';
import { Button } from '../button';
import {
    PiComposer,
    PiMessageList,
} from './pi-conversation-pane-parts';
import {
    formatThinkingLevel,
    formatTimestamp,
    runStateLabel,
} from './pi-conversation-utils';

const EMPTY_TIMELINE: ConversationTimelineItem[] = [];

interface PiConversationPaneProps {
    attachments?: PiStagedAttachment[];
    draft: string;
    isLoadingSession: boolean;
    isSending: boolean;
    isStagingAttachments?: boolean;
    modelLabel: string;
    onAcknowledgeRisk: () => void;
    onAttachFiles?: () => void;
    onCancel: () => void;
    onDraftChange: (value: string) => void;
    onRemoveAttachment?: (attachmentId: string) => void;
    onSend: () => void;
    providerLabel: string | null;
    quickActions?: { key: string; label: string; description: string; onClick: () => void }[];
    riskGateState: PiRiskGateState | null;
    runStatus: PiRunStatus | null;
    session: PiSessionRecord | null;
    skills?: PiSkillSummary[];
}

interface PiDebugLogEntry {
    displayItemId: string;
    displayIndex: number;
    id: string;
    orderSnapshot: string[];
    recordedAt: string;
    status: string;
    summary: string;
    unitKind: PiWorkUnit['kind'];
}

const PI_DEBUG_MODE_STORAGE_KEY = 'quantdesk.pi.debug-mode';

const readPiDebugMode = () => {
    if (typeof window === 'undefined') {
        return false;
    }

    const search = window.location.search;
    const hash = window.location.hash;
    const queryParts = [search, hash.includes('?') ? hash.slice(hash.indexOf('?')) : ''];

    for (const query of queryParts) {
        if (!query) {
            continue;
        }

        const params = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
        const value = params.get('piDebug');

        if (value === '1' || value === 'true') {
            return true;
        }

        if (value === '0' || value === 'false') {
            return false;
        }
    }

    return window.localStorage.getItem(PI_DEBUG_MODE_STORAGE_KEY) === 'true';
};

const buildPiDebugSummary = (item: Extract<ConversationTimelineItem, { kind: 'work_unit' | 'assistant_message' }>) => {
    if (item.kind === 'work_unit') {
        if (item.workUnit.kind === 'reasoning') {
            const firstLine = item.workUnit.summary ?? item.workUnit.content.trim().split(/\r?\n/, 1)[0] ?? 'thinking';
            return firstLine.trim().slice(0, 120) || 'thinking';
        }

        return item.workUnit.toolName;
    }

    const textBlocks = item.assistantMessage.blocks.filter((block): block is Extract<AssistantMessage['blocks'][number], { type: 'text' }> => block.type === 'text');
    return textBlocks[0]?.content.trim().split(/\r?\n/, 1)[0] ?? 'assistant';
};

const buildPiDebugOrderSnapshot = (timeline: ConversationTimelineItem[]) => (
    timeline
        .filter((item): item is Extract<ConversationTimelineItem, { kind: 'work_unit' | 'assistant_message' }> => item.kind === 'work_unit' || item.kind === 'assistant_message')
        .map((item, index) => `${index + 1}. ${buildPiDebugSummary(item)} [${item.kind === 'work_unit' ? item.workUnit.kind : item.kind}]`)
);

const isPiDebugCompletionUnit = (unit: PiWorkUnit) => (
    (unit.kind === 'reasoning' && unit.status === 'complete')
    || (unit.kind === 'tool_call' && ['complete', 'error', 'cancelled', 'rejected'].includes(unit.status))
);

const formatDebugTimestamp = (value: string) => value.slice(11, 23);

export const PiConversationPane = ({
    attachments = [],
    draft,
    isLoadingSession,
    isSending,
    isStagingAttachments = false,
    modelLabel,
    onAcknowledgeRisk,
    onAttachFiles,
    onCancel,
    onDraftChange,
    onRemoveAttachment,
    onSend,
    providerLabel,
    quickActions,
    riskGateState,
    runStatus,
    session,
    skills = [],
}: PiConversationPaneProps) => {
    const approvalBlock = session?.projection.approvalBlock ?? null;
    const riskAcknowledged = approvalBlock
        ? approvalBlock.status !== 'requires_approval'
        : (riskGateState?.acknowledged ?? false);
    const latestFailureMessage = runStatus?.state === 'failed'
        ? (runStatus.lastError ?? session?.lastError ?? null)
        : null;
    const timeline = session?.projection.timeline ?? EMPTY_TIMELINE;
    const currentToolLabel = runStatus?.currentTool ?? session?.lastToolName ?? '暂无工具';
    const riskMessage = (typeof approvalBlock?.input.message === 'string' ? approvalBlock.input.message : null)
        ?? riskGateState?.message
        ?? 'Pi 可以读写本地文件并执行命令，确认后再继续。';
    const autoScrollKey = useMemo(() => {
        const lastItem = timeline[timeline.length - 1];

        if (!lastItem) {
            return 'empty';
        }

        if (lastItem.kind === 'assistant_message') {
            const lastBlock = lastItem.assistantMessage.blocks[lastItem.assistantMessage.blocks.length - 1];
            return `${timeline.length}:${lastItem.id}:${lastItem.assistantMessage.status}:${lastBlock?.id ?? 'none'}`;
        }

        if (lastItem.kind === 'work_unit') {
            return `${timeline.length}:${lastItem.id}:${lastItem.workUnit.kind}:${lastItem.workUnit.status}`;
        }

        return `${timeline.length}:${lastItem.id}:${lastItem.role}:${lastItem.content.length}`;
    }, [timeline]);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const loggedCompletionKeysRef = useRef(new Set<string>());
    const [debugEnabled, setDebugEnabled] = useState(readPiDebugMode);
    const [debugLogEntries, setDebugLogEntries] = useState<PiDebugLogEntry[]>([]);
    const [sessionInfoOpen, setSessionInfoOpen] = useState(false);
    const currentDisplayOrder = useMemo(
        () => buildPiDebugOrderSnapshot(timeline),
        [timeline],
    );

    useEffect(() => {
        const node = containerRef.current;

        if (!node) {
            return undefined;
        }

        const frameId = window.requestAnimationFrame(() => {
            node.scrollTop = node.scrollHeight;
        });

        return () => {
            window.cancelAnimationFrame(frameId);
        };
    }, [autoScrollKey]);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }

        window.localStorage.setItem(PI_DEBUG_MODE_STORAGE_KEY, String(debugEnabled));
    }, [debugEnabled]);

    useEffect(() => {
        loggedCompletionKeysRef.current = new Set();
        setDebugLogEntries([]);
    }, [session?.id]);

    useEffect(() => {
        if (!debugEnabled || !session) {
            return;
        }

        const nextEntries: PiDebugLogEntry[] = [];
        const displayItems = session.projection.timeline.filter((item): item is Extract<ConversationTimelineItem, { kind: 'work_unit' | 'assistant_message' }> => item.kind === 'work_unit' || item.kind === 'assistant_message');
        const orderSnapshot = buildPiDebugOrderSnapshot(session.projection.timeline);

        displayItems.forEach((item, index) => {
            if (item.kind !== 'work_unit' || !isPiDebugCompletionUnit(item.workUnit)) {
                return;
            }

            const completionKey = `${session.id}:${item.id}:${item.workUnit.status}`;

            if (loggedCompletionKeysRef.current.has(completionKey)) {
                return;
            }

            loggedCompletionKeysRef.current.add(completionKey);
            nextEntries.push({
                displayIndex: index + 1,
                displayItemId: item.id,
                id: completionKey,
                orderSnapshot,
                recordedAt: new Date().toISOString(),
                status: item.workUnit.status,
                summary: buildPiDebugSummary(item),
                unitKind: item.workUnit.kind,
            });
        });

        if (nextEntries.length === 0) {
            return;
        }

        nextEntries.forEach((entry) => {
            console.info('[pi-debug-order]', entry);
        });
        setDebugLogEntries((current) => [...current, ...nextEntries]);
    }, [debugEnabled, session]);

    return (
        <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-[20px] border border-[color:var(--color-border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.97),rgba(249,244,237,0.94))] shadow-[0_18px_52px_rgba(61,43,31,0.08)]">
            <header className="relative z-20 shrink-0 border-b border-[color:var(--color-border)] px-4 py-2 sm:px-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-muted)] [@media(max-height:640px)]:hidden">当前会话</p>
                        <h3 className="mt-1.5 truncate text-[1rem] font-semibold leading-5 text-[var(--color-foreground)] [@media(max-height:640px)]:mt-0">
                            {session?.title || '新会话'}
                        </h3>
                    </div>

                    <div className="flex items-center gap-2">
                        <Button
                            aria-expanded={sessionInfoOpen}
                            className="h-8 rounded-[11px] px-2.5"
                            data-testid="pi-agent-session-info-toggle"
                            onClick={() => { setSessionInfoOpen((current) => !current); }}
                            size="sm"
                            tone="secondary"
                            type="button"
                        >
                            <span>详情</span>
                            <span aria-hidden="true" className={['font-mono text-[10px] transition-transform duration-200', sessionInfoOpen ? 'rotate-180' : ''].join(' ')}>⌄</span>
                        </Button>
                    </div>
                </div>

                {sessionInfoOpen && (
                    <section className="absolute left-4 right-4 top-[calc(100%+0.5rem)] z-40 grid max-h-[calc(100vh-16rem)] gap-2.5 overflow-y-auto rounded-[16px] border border-[rgba(70,53,43,0.1)] bg-[rgba(255,252,248,0.98)] p-3 shadow-[0_18px_46px_rgba(61,43,31,0.14)] backdrop-blur sm:left-auto sm:w-[520px] sm:grid-cols-2 sm:px-3.5" data-testid="pi-agent-session-info-panel">
                        {[
                            ['状态', runStateLabel[runStatus?.state ?? 'idle']],
                            ['模型', modelLabel],
                            ['来源', providerLabel ?? '来源未标注'],
                            ['当前工具', currentToolLabel],
                            ['思考', session?.transcript.thinkingLevel ? formatThinkingLevel(session.transcript.thinkingLevel) : '默认'],
                            ['更新', formatTimestamp(runStatus?.updatedAt ?? session?.updatedAt)],
                        ].map(([label, value]) => (
                            <div className="min-w-0" key={label}>
                                <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--color-muted)]">{label}</p>
                                <p className="mt-1 truncate text-xs font-medium leading-5 text-[var(--color-foreground)]">{value}</p>
                            </div>
                        ))}
                        {session?.cwd ? (
                            <div className="min-w-0 sm:col-span-2 xl:col-span-2">
                                <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--color-muted)]">目录</p>
                                <p className="mt-1 truncate font-mono text-[10px] leading-5 text-[var(--color-copy)]">{session.cwd}</p>
                            </div>
                        ) : null}
                        <div className="flex items-end gap-2">
                            {debugEnabled ? <Badge tone="accent">Debug On</Badge> : null}
                            <Button data-testid="pi-agent-debug-toggle" onClick={() => { setDebugEnabled((current) => !current); }} size="sm" tone={debugEnabled ? 'primary' : 'secondary'} type="button">
                                {debugEnabled ? '关闭 Debug' : '开启 Debug'}
                            </Button>
                        </div>
                    </section>
                )}
            </header>

            {debugEnabled && (
                <section className="border-b border-[rgba(120,86,60,0.12)] bg-[rgba(248,243,235,0.7)] px-4 py-3 sm:px-5" data-testid="pi-agent-debug-panel">
                    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
                        <article className="rounded-[16px] border border-[rgba(120,86,60,0.12)] bg-[rgba(255,255,255,0.82)] px-3.5 py-3">
                            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted)]">当前展示顺序</p>
                            {currentDisplayOrder.length > 0 ? (
                                <ol className="mt-2 space-y-1.5 text-sm leading-6 text-[var(--color-copy)]">
                                    {currentDisplayOrder.map((item) => (
                                        <li key={item}>{item}</li>
                                    ))}
                                </ol>
                            ) : (
                                <p className="mt-2 text-sm leading-6 text-[var(--color-copy)]">当前还没有 assistant block。</p>
                            )}
                        </article>

                        <article className="rounded-[16px] border border-[rgba(120,86,60,0.12)] bg-[rgba(255,255,255,0.82)] px-3.5 py-3">
                            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted)]">完成日志</p>
                            {debugLogEntries.length > 0 ? (
                                <div className="mt-2 max-h-[180px] space-y-2 overflow-y-auto pr-1 text-sm leading-6 text-[var(--color-copy)]">
                                    {debugLogEntries.map((entry) => (
                                        <article className="rounded-[12px] border border-[rgba(120,86,60,0.1)] bg-[rgba(248,243,235,0.52)] px-3 py-2" key={entry.id}>
                                            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--color-muted)]">
                                                {formatDebugTimestamp(entry.recordedAt)} · {entry.unitKind} · #{entry.displayIndex} · {entry.status}
                                            </p>
                                            <p className="mt-1 text-[13px] font-medium leading-5 text-[var(--color-foreground)]">{entry.summary}</p>
                                            <p className="mt-1 text-xs leading-5 text-[var(--color-copy)]">顺序快照：{entry.orderSnapshot.join(' | ')}</p>
                                        </article>
                                    ))}
                                </div>
                            ) : (
                                <p className="mt-2 text-sm leading-6 text-[var(--color-copy)]">等待 thinking 或 tool call 完成后记录时间。</p>
                            )}
                        </article>
                    </div>
                </section>
            )}

            <div className="relative min-h-0 flex-1 overflow-hidden">
                <div className="h-full min-h-0 overflow-y-auto px-4 pb-4 pt-4 sm:px-5" data-agent-scroll="1" ref={containerRef}>
                    <div className="w-full space-y-5">
                        <div className="space-y-4" data-testid="pi-agent-message-list">
                            <PiMessageList
                                isLoadingSession={isLoadingSession}
                                isSending={isSending}
                                onStop={onCancel}
                                quickActions={quickActions}
                                threadId={session?.id ?? 'new-pi-session'}
                                timeline={timeline}
                            />
                        </div>
                    </div>
                </div>
            </div>

            <footer className="shrink-0 border-t border-[rgba(120,86,60,0.12)] bg-[rgba(255,255,255,0.88)] px-4 py-2.5 sm:px-5">
                <div className="w-full space-y-2.5">
                    {latestFailureMessage && (
                        <div className="rounded-[16px] border border-[rgba(255,108,87,0.24)] bg-[rgba(255,108,87,0.1)] px-3.5 py-3 text-sm leading-6 text-[#ffb2a6]" data-testid="pi-agent-run-failure-banner">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#ffb2a6]">运行失败</p>
                                <Badge tone="danger">{runStateLabel[runStatus?.state ?? 'failed']}</Badge>
                            </div>
                            <p className="mt-1.5 font-medium text-[#ffe0da]">最近一次 Pi 运行失败</p>
                            <p className="mt-1.5 whitespace-pre-wrap break-words">{latestFailureMessage}</p>
                        </div>
                    )}

                    <PiComposer
                        attachments={attachments}
                        draft={draft}
                        isSending={isSending}
                        isStagingAttachments={isStagingAttachments}
                        onAcknowledgeRisk={onAcknowledgeRisk}
                        onAttachFiles={onAttachFiles}
                        onCancel={onCancel}
                        onDraftChange={onDraftChange}
                        onRemoveAttachment={onRemoveAttachment}
                        onSend={onSend}
                        riskAcknowledged={riskAcknowledged}
                        riskNotice={riskMessage}
                        skills={skills}
                    />
                </div>
            </footer>
        </section>
    );
};
