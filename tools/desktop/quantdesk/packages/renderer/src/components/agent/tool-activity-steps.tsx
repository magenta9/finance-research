import { useEffect, useState } from 'react';
import type { AgentConversationToolStep, ToolHistoryAvailability } from '@quantdesk/shared';

import { Badge } from '../badge';
import { Button } from '../button';

interface ToolActivityStepsProps {
    metadata?: string[];
    replayUnavailable: boolean;
    steps: AgentConversationToolStep[];
    summaryLabel: string | null;
    toolHistoryAvailability: ToolHistoryAvailability;
    turnId: string;
}

const statusLabelMap: Record<AgentConversationToolStep['status'], string> = {
    cancelled: '已取消',
    error: '失败',
    running: '进行中',
    success: '完成',
    timeout: '超时',
};

const formatTimestamp = (value: string | null | undefined) => (
    value ? value.slice(11, 19) : '未知时间'
);

const stepStatusTone = (status: AgentConversationToolStep['status']) => {
    if (status === 'error' || status === 'timeout') {
        return 'danger';
    }

    if (status === 'cancelled') {
        return 'muted';
    }

    return 'accent';
};

const stringifyPayload = (value: unknown) => {
    if (value == null) {
        return null;
    }

    if (typeof value === 'string') {
        return value;
    }

    try {
        return JSON.stringify(value, null, 2);
    } catch (error) {
        return error instanceof Error ? `${String(value)} (${error.message})` : String(value);
    }
};

export const ToolActivitySteps = ({
    metadata = [],
    replayUnavailable,
    steps,
    summaryLabel,
    toolHistoryAvailability,
    turnId,
}: ToolActivityStepsProps) => {
    const hasRunningStep = steps.some((step) => step.status === 'running');
    const [open, setOpen] = useState(hasRunningStep);
    const latestStep = steps[steps.length - 1] ?? null;
    const summaryPreview = latestStep?.summary ?? latestStep?.toolName ?? null;

    useEffect(() => {
        if (hasRunningStep) {
            setOpen(true);
        }
    }, [hasRunningStep]);

    if (!summaryLabel && steps.length === 0 && !replayUnavailable && toolHistoryAvailability !== 'loading') {
        return null;
    }

    return (
        <section
            className="mt-4 rounded-[16px] border border-[color:var(--color-border)] bg-[rgba(255,255,255,0.02)] p-3"
            data-testid={`agent-activity-${turnId}`}
        >
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                    <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-muted)]">执行证据</p>
                    <p
                        className="mt-1.5 text-sm font-medium text-[var(--color-foreground)]"
                        data-testid={`agent-activity-summary-${turnId}`}
                    >
                        {summaryLabel ?? '暂无工具记录'}
                    </p>
                    {summaryPreview && (
                        <p className="mt-1 text-xs leading-5 text-[var(--color-muted)]">{summaryPreview}</p>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {steps.length > 0 && <Badge tone="accent">{steps.length} 条</Badge>}
                    <Button
                        className="h-9 rounded-full px-3"
                        data-testid={`agent-activity-toggle-${turnId}`}
                        onClick={() => {
                            setOpen((current) => !current);
                        }}
                        size="sm"
                        tone="ghost"
                    >
                        {open ? '收起' : '展开'}
                    </Button>
                </div>
            </div>

            {metadata.length > 0 && (
                <div className="mt-2.5 flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
                    {metadata.map((item) => <span key={item}>{item}</span>)}
                </div>
            )}

            {open && (
                <div className="mt-3 space-y-2.5" data-testid={`agent-tool-steps-${turnId}`}>
                    {toolHistoryAvailability === 'loading' && steps.length === 0 && (
                        <div className="rounded-[16px] border border-dashed border-[color:var(--color-border)] bg-[rgba(255,255,255,0.03)] p-4 text-sm text-[var(--color-copy)]">
                            正在载入这轮工具记录...
                        </div>
                    )}

                    {steps.map((step, index) => {
                        const inputPayload = stringifyPayload(step.input);
                        const outputPayload = stringifyPayload(step.output);

                        return (
                            <article
                                className="rounded-[14px] border border-[color:var(--color-border)] bg-[rgba(255,255,255,0.03)] p-3"
                                data-testid={`agent-tool-step-${turnId}-${index}`}
                                key={step.id}
                            >
                                <div className="flex flex-wrap items-center gap-2">
                                    <Badge className="normal-case tracking-[0.08em]">{step.toolName}</Badge>
                                    <Badge tone={stepStatusTone(step.status)}>
                                        {statusLabelMap[step.status]}
                                    </Badge>
                                    <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-muted)]">
                                        {formatTimestamp(step.startedAt)}
                                        {step.finishedAt ? ` → ${formatTimestamp(step.finishedAt)}` : ''}
                                    </span>
                                </div>

                                {step.summary && (
                                    <p className="mt-2 text-sm leading-6 text-[var(--color-copy)]">{step.summary}</p>
                                )}

                                {step.errorMessage && (
                                    <p className="mt-2 text-sm leading-6 text-[#7d2c22]">{step.errorMessage}</p>
                                )}

                                {(inputPayload || outputPayload) && (
                                    <details className="mt-2.5 rounded-[12px] border border-[color:var(--color-border)] bg-[rgba(255,255,255,0.02)] p-3">
                                        <summary className="cursor-pointer font-mono text-xs uppercase tracking-[0.18em] text-[var(--color-muted)]">
                                            原始输入输出
                                        </summary>
                                        <div className="mt-3 space-y-3 text-xs leading-6 text-[var(--color-copy)]">
                                            {inputPayload && (
                                                <div>
                                                    <p className="font-mono font-medium uppercase tracking-[0.18em] text-[var(--color-muted)]">输入</p>
                                                    <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-[12px] bg-[rgba(0,0,0,0.22)] p-3">{inputPayload}</pre>
                                                </div>
                                            )}
                                            {outputPayload && (
                                                <div>
                                                    <p className="font-mono font-medium uppercase tracking-[0.18em] text-[var(--color-muted)]">输出</p>
                                                    <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-[12px] bg-[rgba(0,0,0,0.22)] p-3">{outputPayload}</pre>
                                                </div>
                                            )}
                                        </div>
                                    </details>
                                )}
                            </article>
                        );
                    })}

                    {replayUnavailable && (
                        <div className="rounded-[14px] border border-[rgba(197,138,77,0.22)] bg-[rgba(197,138,77,0.08)] p-3 text-sm leading-6 text-[#f1cb9e]">
                            这条旧会话缺少完整关联，下面是按时间顺序整理的记录。
                        </div>
                    )}
                </div>
            )}
        </section>
    );
};