import { memo, useState, type ReactNode } from 'react';

import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type { PiToolStep } from '@quantdesk/shared';

import { Badge } from '../badge';
import { Button } from '../button';

import {
    buildToolActivitySummary,
    compactPreview,
    formatJsonPreview,
    formatTimestamp,
    resolveToolTone,
    roleLabelMap,
    toolStepLabelMap,
    type PiConversationTranscriptMessage,
    type PiConversationTurn,
} from './pi-conversation-utils';

interface AnimatedCollapseProps {
    children: ReactNode;
    open: boolean;
}

const AnimatedCollapse = ({ children, open }: AnimatedCollapseProps) => (
    <div
        className="grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none"
        style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
    >
        <div className="overflow-hidden">
            {children}
        </div>
    </div>
);

interface CollapsibleSectionProps {
    children: ReactNode;
    defaultOpen?: boolean;
    flat?: boolean;
    summary: ReactNode;
    testId?: string;
}

const CollapsibleSection = ({ children, defaultOpen = false, flat = false, summary, testId }: CollapsibleSectionProps) => {
    const [open, setOpen] = useState(defaultOpen);

    return (
        <section
            className={flat ? '' : 'rounded-[14px] border border-[color:var(--color-border)] bg-[rgba(255,255,255,0.03)]'}
            data-testid={testId}
        >
            <Button
                aria-expanded={open}
                className={[
                    'flex w-full items-start justify-between gap-3 text-left transition',
                    flat ? 'rounded-[10px] px-0 py-2 hover:bg-transparent' : 'rounded-[14px] px-3.5 py-3 hover:bg-[rgba(255,255,255,0.05)]',
                ].join(' ')}
                onClick={() => { setOpen((current) => !current); }}
                size="none"
                type="button"
            >
                <div className="min-w-0 flex-1">{summary}</div>
                <span
                    aria-hidden="true"
                    className={[
                        'mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center text-[10px] text-[var(--color-muted)] transition-transform duration-200 ease-out',
                        flat ? 'rounded-full bg-transparent' : 'rounded-full border border-[color:var(--color-border)] bg-[rgba(255,255,255,0.03)]',
                    ].join(' ')}
                    style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
                >
                    ⌄
                </span>
            </Button>
            <AnimatedCollapse open={open}>
                <div className={flat ? 'pb-1 pt-0.5' : 'px-3.5 pb-3.5 pt-1'}>{children}</div>
            </AnimatedCollapse>
        </section>
    );
};

const StreamingCaret = () => (
    <span
        aria-hidden="true"
        className="ml-1 inline-block h-4 w-[2px] -translate-y-[1px] animate-pulse rounded-sm bg-[var(--color-highlight)] align-middle"
    />
);

const markdownComponents: Components = {
    p: ({ children }) => <p className="leading-7 text-[var(--color-copy)]">{children}</p>,
    ul: ({ children }) => <ul className="list-disc space-y-2 pl-5 text-[var(--color-copy)]">{children}</ul>,
    ol: ({ children }) => <ol className="list-decimal space-y-2 pl-5 text-[var(--color-copy)]">{children}</ol>,
    strong: ({ children }) => <strong className="font-semibold text-[var(--color-foreground)]">{children}</strong>,
};

interface PiSupplementalMessageCardProps {
    message: PiConversationTranscriptMessage;
}

export const PiSupplementalMessageCard = memo(({
    message,
}: PiSupplementalMessageCardProps) => {
    const content = message.content.trim().length > 0 ? message.content : '暂无内容。';

    return (
        <article
            className="rounded-[14px] border border-[color:var(--color-border)] bg-[rgba(255,255,255,0.03)] p-3"
            data-testid={`pi-agent-message-${message.role}-${message.id}`}
        >
            <div className="flex flex-wrap items-center gap-2">
                <Badge tone="muted">{roleLabelMap[message.role] ?? message.role}</Badge>
                {message.toolName ? <Badge className="normal-case tracking-[0.08em]">{message.toolName}</Badge> : null}
            </div>
            <div className="prose prose-sm mt-3 max-w-none prose-p:my-0 prose-strong:text-[var(--color-foreground)]">
                <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
                    {content}
                </ReactMarkdown>
            </div>
        </article>
    );
});

PiSupplementalMessageCard.displayName = 'PiSupplementalMessageCard';

interface PiToolStepCardProps {
    step: PiToolStep;
}

const PiToolStepCard = memo(({
    step,
}: PiToolStepCardProps) => {
    const hasArguments = Object.keys(step.args).length > 0;
    const runningPreview = step.partialResult != null ? formatJsonPreview(step.partialResult) : null;
    const finalPreview = step.result != null ? formatJsonPreview(step.result) : null;

    return (
        <article
            className="rounded-[14px] border border-[color:var(--color-border)] bg-[rgba(255,255,255,0.03)] p-3"
            data-testid={`pi-agent-tool-step-${step.toolCallId}`}
        >
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={resolveToolTone(step)}>{toolStepLabelMap[step.status]}</Badge>
                        <Badge className="normal-case tracking-[0.08em]">{step.toolName}</Badge>
                    </div>
                    {step.summary ? (
                        <p className="mt-1.5 text-sm font-medium leading-6 text-[var(--color-foreground)]">{step.summary}</p>
                    ) : (
                        <p className="mt-1.5 text-sm leading-6 text-[var(--color-copy)]">暂无摘要。</p>
                    )}
                </div>

                <div className="text-right text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted)]">
                    <p>{formatTimestamp(step.startedAt)}</p>
                    <p className="mt-1">{step.finishedAt ? formatTimestamp(step.finishedAt) : '进行中'}</p>
                </div>
            </div>

            {step.error ? (
                <p className="mt-2.5 rounded-[12px] border border-[rgba(255,108,87,0.22)] bg-[rgba(255,108,87,0.08)] px-3 py-2 text-sm leading-6 text-[#ffb2a6]">
                    {step.error.message}
                </p>
            ) : null}

            <div className="mt-2.5">
                <CollapsibleSection
                    summary={(
                        <span className="text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted)]">原始数据</span>
                    )}
                    testId={`pi-agent-tool-step-payload-${step.toolCallId}`}
                >
                    <div className="space-y-3 text-sm leading-6 text-[var(--color-copy)]">
                        {hasArguments ? (
                            <div>
                                <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted)]">调用参数</p>
                                <pre className="mt-2 overflow-x-auto rounded-[14px] border border-[color:var(--color-border)] bg-[rgba(0,0,0,0.22)] p-3 text-xs leading-6 text-[var(--color-foreground)]">
                                    {formatJsonPreview(step.args)}
                                </pre>
                            </div>
                        ) : (
                            <p className="text-xs text-[var(--color-muted)]">没有可展开的调用参数。</p>
                        )}

                        {step.status === 'running' && runningPreview ? (
                            <div>
                                <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted)]">中间结果</p>
                                <pre className="mt-2 overflow-x-auto rounded-[14px] border border-[color:var(--color-border)] bg-[rgba(0,0,0,0.22)] p-3 text-xs leading-6 text-[var(--color-foreground)]">
                                    {runningPreview}
                                </pre>
                            </div>
                        ) : null}

                        {step.status !== 'running' && finalPreview ? (
                            <div>
                                <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted)]">结果</p>
                                <pre className="mt-2 overflow-x-auto rounded-[14px] border border-[color:var(--color-border)] bg-[rgba(0,0,0,0.22)] p-3 text-xs leading-6 text-[var(--color-foreground)]">
                                    {finalPreview}
                                </pre>
                            </div>
                        ) : null}
                    </div>
                </CollapsibleSection>
            </div>
        </article>
    );
});

PiToolStepCard.displayName = 'PiToolStepCard';

interface PiConversationTurnCardProps {
    isSending: boolean;
    modelLabel: string;
    providerLabel: string | null;
    turn: PiConversationTurn;
}

export const PiConversationTurnCard = memo(({
    isSending,
    modelLabel,
    providerLabel,
    turn,
}: PiConversationTurnCardProps) => {
    const assistantMessage = turn.assistantMessage;
    const activitySummary = buildToolActivitySummary(turn);
    const hasAnswerCard = Boolean(assistantMessage || isSending);
    const hasAnswerText = assistantMessage ? assistantMessage.content.trim().length > 0 : false;
    const isAnswerStreaming = isSending && (
        !assistantMessage
        || (assistantMessage.phase === 'assistant' && !assistantMessage.isError)
    );
    const answerContent = hasAnswerText
        ? (assistantMessage?.content ?? '')
        : (isSending ? '正在写回答...' : '这一轮已经结束。');
    const thinkingSummary = turn.thinkingMessages.length > 0
        ? compactPreview(turn.thinkingMessages[turn.thinkingMessages.length - 1]?.content ?? '') || '思考中'
        : null;
    const thinkingDefaultOpen = turn.thinkingMessages.length > 0 && (isSending || !assistantMessage);

    return (
        <article className="space-y-2.5" data-testid={`pi-agent-turn-${turn.id}`}>
            {turn.userMessage ? (
                <div className="flex justify-end">
                    <section
                        className="max-w-[82%] rounded-[18px] border border-[rgba(197,138,77,0.22)] bg-[rgba(197,138,77,0.12)] p-3.5"
                        data-testid={`pi-agent-turn-user-${turn.userMessage.id}`}
                    >
                        <div className="flex flex-wrap items-center gap-2">
                            <Badge tone="accent">提问</Badge>
                            <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">用户</span>
                        </div>
                        <p className="mt-2.5 whitespace-pre-wrap break-words text-sm leading-7 text-[var(--color-copy)]">
                            {turn.userMessage.content || '暂无内容。'}
                        </p>
                    </section>
                </div>
            ) : null}

            {hasAnswerCard ? (
                <section
                    className={[
                        'relative overflow-hidden p-1',
                        isAnswerStreaming ? 'pi-streaming-card' : '',
                    ].join(' ')}
                    data-streaming={isAnswerStreaming ? 'true' : undefined}
                    data-testid={`pi-agent-turn-assistant-${assistantMessage?.id ?? turn.id}`}
                >
                    {isAnswerStreaming ? (
                        <span aria-hidden="true" className="pi-streaming-shimmer pointer-events-none absolute inset-x-0 top-0 h-[2px]" />
                    ) : null}

                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                            <Badge tone={assistantMessage?.isError ? 'danger' : 'accent'}>回答结果</Badge>
                            {assistantMessage?.isError ? <Badge tone="danger">错误</Badge> : null}
                        </div>
                        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
                            {isAnswerStreaming ? '生成中…' : '结果'}
                        </span>
                    </div>

                    <div className="prose prose-sm mt-3 max-w-none prose-p:my-0 prose-strong:text-[var(--color-foreground)]">
                        <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
                            {answerContent}
                        </ReactMarkdown>
                        {isAnswerStreaming ? <StreamingCaret /> : null}
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-muted)]">
                        <span>{modelLabel}</span>
                        <span>{providerLabel ?? '来源未标注'}</span>
                        {assistantMessage?.toolName ? <span>工具 {assistantMessage.toolName}</span> : null}
                    </div>

                    {turn.thinkingMessages.length > 0 || activitySummary ? (
                        <div className="mt-3.5 rounded-[14px] border border-[color:var(--color-border)] bg-[rgba(255,255,255,0.03)] px-3.5 py-2.5">
                            {turn.thinkingMessages.length > 0 ? (
                                <div data-testid={`pi-agent-turn-thinking-${turn.id}`}>
                                    <CollapsibleSection
                                        defaultOpen={thinkingDefaultOpen}
                                        flat
                                        summary={(
                                            <div className="min-w-0">
                                                <Badge tone="muted">思考</Badge>
                                                <p className="mt-1.5 text-sm font-medium leading-6 text-[var(--color-foreground)]">{thinkingSummary}</p>
                                            </div>
                                        )}
                                    >
                                        <div className="space-y-3 pb-1">
                                            {turn.thinkingMessages.map((message) => (
                                                <div
                                                    className="prose prose-sm max-w-none prose-p:my-0 prose-strong:text-[var(--color-foreground)]"
                                                    key={message.id}
                                                >
                                                    <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
                                                        {message.content || '思考内容已收起。'}
                                                    </ReactMarkdown>
                                                </div>
                                            ))}
                                        </div>
                                    </CollapsibleSection>
                                </div>
                            ) : null}

                            {activitySummary ? (
                                <div className={turn.thinkingMessages.length > 0 ? 'mt-2 border-t border-[rgba(255,255,255,0.06)] pt-2' : ''} data-testid={`pi-agent-turn-activity-${turn.id}`}>
                                    <CollapsibleSection
                                        defaultOpen={activitySummary.open}
                                        flat
                                        summary={(
                                            <div className="min-w-0">
                                                <Badge tone={activitySummary.tone}>活动</Badge>
                                                <p className="mt-1.5 text-sm font-medium leading-6 text-[var(--color-foreground)]">{activitySummary.caption}</p>
                                                <p className="mt-1 text-xs leading-5 text-[var(--color-muted)]">{activitySummary.detail}</p>
                                            </div>
                                        )}
                                    >
                                        <div className="space-y-3 pb-1">
                                            {turn.toolSteps.length > 0 ? (
                                                turn.toolSteps.map((step) => (
                                                    <PiToolStepCard key={step.toolCallId} step={step} />
                                                ))
                                            ) : (
                                                <p className="text-sm leading-6 text-[var(--color-muted)]">工具执行记录暂未同步。</p>
                                            )}
                                        </div>
                                    </CollapsibleSection>
                                </div>
                            ) : null}
                        </div>
                    ) : null}
                </section>
            ) : null}

            {turn.supplementalMessages.map((message) => (
                <PiSupplementalMessageCard key={message.id} message={message} />
            ))}
        </article>
    );
});

PiConversationTurnCard.displayName = 'PiConversationTurnCard';