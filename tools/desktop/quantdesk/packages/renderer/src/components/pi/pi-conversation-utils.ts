import type { PiRunStatus, PiSessionRecord, PiToolStep } from '@quantdesk/shared';

export const runStateLabel: Record<PiRunStatus['state'], string> = {
    cancelled: '已取消',
    failed: '失败',
    idle: '空闲',
    running: '运行中',
};

const thinkingLevelLabelMap: Record<string, string> = {
    balanced: '平衡',
    deep: '深度',
    off: '关闭',
};

export const roleLabelMap: Record<string, string> = {
    assistant: '回答',
    summary: '摘要',
    system: '提示',
    tool_call: '工具调用',
    tool_result: '工具结果',
    user: '提问',
};

export const toolStepLabelMap: Record<PiToolStep['status'], string> = {
    cancelled: '已取消',
    error: '失败',
    running: '进行中',
    success: '已完成',
};

export const formatTimestamp = (value: string | null | undefined) => (
    value ? value.slice(0, 19).replace('T', ' ') : '刚刚'
);

export const runStateTone = (state: PiRunStatus['state'] | null | undefined) => {
    if (state === 'failed') {
        return 'danger';
    }

    if (state === 'running') {
        return 'accent';
    }

    if (state === 'cancelled') {
        return 'muted';
    }

    return 'default';
};

export const formatThinkingLevel = (value: string | null | undefined) => {
    if (!value) {
        return '未解析';
    }

    return thinkingLevelLabelMap[value] ?? value;
};

export const compactPreview = (value: string) => {
    const normalized = value.replace(/\s+/g, ' ').trim();

    if (!normalized) {
        return '';
    }

    if (normalized.length <= 120) {
        return normalized;
    }

    return `${normalized.slice(0, 120)}…`;
};

export const formatJsonPreview = (value: unknown) => {
    if (value == null) {
        return null;
    }

    try {
        return JSON.stringify(value, null, 2);
    } catch (error) {
        return error instanceof Error ? `${String(value)} (${error.message})` : String(value);
    }
};

export const resolveToolTone = (step: PiToolStep | undefined) => {
    if (!step) {
        return 'default';
    }

    if (step.status === 'error') {
        return 'danger';
    }

    if (step.status === 'running') {
        return 'accent';
    }

    return 'default';
};

export type PiConversationTranscriptMessage = PiSessionRecord['transcript']['messages'][number];

export interface PiConversationTurn {
    assistantMessage: PiConversationTranscriptMessage | null;
    id: string;
    supplementalMessages: PiConversationTranscriptMessage[];
    thinkingMessages: PiConversationTranscriptMessage[];
    toolCallIds: string[];
    toolNames: string[];
    toolSteps: PiToolStep[];
    userMessage: PiConversationTranscriptMessage | null;
}

export interface PiConversationTimeline {
    orphanMessages: PiConversationTranscriptMessage[];
    turns: PiConversationTurn[];
}

const addUniqueValue = (values: string[], value: string) => {
    if (!values.includes(value)) {
        values.push(value);
    }
};

export const buildConversationTimeline = (
    messages: PiSessionRecord['transcript']['messages'],
    toolStepByCallId: Map<string, PiToolStep>,
): PiConversationTimeline => {
    const orphanMessages: PiConversationTranscriptMessage[] = [];
    const turns: PiConversationTurn[] = [];
    let currentTurn: PiConversationTurn | null = null;

    const finishTurn = () => {
        if (currentTurn) {
            turns.push(currentTurn);
            currentTurn = null;
        }
    };

    for (const message of messages) {
        if (message.role === 'user') {
            finishTurn();
            currentTurn = {
                assistantMessage: null,
                id: message.id,
                supplementalMessages: [],
                thinkingMessages: [],
                toolCallIds: [],
                toolNames: [],
                toolSteps: [],
                userMessage: message,
            };
            continue;
        }

        if (!currentTurn) {
            orphanMessages.push(message);
            continue;
        }

        if (message.role === 'assistant') {
            if (message.phase === 'thinking') {
                currentTurn.thinkingMessages.push(message);
            } else {
                currentTurn.assistantMessage = message;
            }
            continue;
        }

        if (message.role === 'tool_call' || message.role === 'tool_result') {
            const toolCallId = message.toolCallId ?? message.id;
            addUniqueValue(currentTurn.toolCallIds, toolCallId);

            if (message.toolName) {
                addUniqueValue(currentTurn.toolNames, message.toolName);
            }

            continue;
        }

        currentTurn.supplementalMessages.push(message);
    }

    finishTurn();

    return {
        orphanMessages,
        turns: turns.map((turn) => ({
            ...turn,
            toolSteps: turn.toolCallIds
                .map((toolCallId) => toolStepByCallId.get(toolCallId))
                .filter((step): step is PiToolStep => Boolean(step)),
        })),
    };
};

export interface PiToolActivitySummary {
    caption: string;
    detail: string;
    open: boolean;
    tone: 'default' | 'accent' | 'muted' | 'danger';
}

export const buildToolActivitySummary = (turn: PiConversationTurn): PiToolActivitySummary | null => {
    if (turn.toolSteps.length === 0 && turn.toolNames.length === 0) {
        return null;
    }

    if (turn.toolSteps.length === 0) {
        return {
            caption: `活动步骤 · ${turn.toolNames.length} 项`,
            detail: '工具执行记录暂未同步。',
            open: false,
            tone: 'muted',
        };
    }

    const runningCount = turn.toolSteps.filter((step) => step.status === 'running').length;
    const errorCount = turn.toolSteps.filter((step) => step.status === 'error').length;
    const cancelledCount = turn.toolSteps.filter((step) => step.status === 'cancelled').length;
    const latestStep = turn.toolSteps[turn.toolSteps.length - 1] ?? null;

    const latestLabel = latestStep
        ? `${latestStep.toolName}${latestStep.summary ? ` · ${compactPreview(latestStep.summary)}` : ''}`
        : '暂无摘要';

    if (runningCount > 0) {
        return {
            caption: `活动步骤 · ${turn.toolSteps.length} 项`,
            detail: `进行中：${latestLabel}`,
            open: true,
            tone: 'accent',
        };
    }

    if (errorCount > 0) {
        return {
            caption: `活动步骤 · ${turn.toolSteps.length} 项`,
            detail: `失败：${latestLabel}`,
            open: true,
            tone: 'danger',
        };
    }

    if (cancelledCount > 0) {
        return {
            caption: `活动步骤 · ${turn.toolSteps.length} 项`,
            detail: `已取消：${latestLabel}`,
            open: false,
            tone: 'muted',
        };
    }

    return {
        caption: `活动步骤 · ${turn.toolSteps.length} 项`,
        detail: latestLabel,
        open: false,
        tone: 'default',
    };
};