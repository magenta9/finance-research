import {
    buildContentBlockId,
    type AssistantContentProjection,
    type AssistantMessage,
    type ContentBlock,
    type PiAssistantMessageLifecycleItem,
    type PiItemEvent,
    type PiReasoningLifecycleItem,
    type PiToolCallLifecycleItem,
    type PiWorkUnit,
} from './types/agent-content-block';

const cloneBlock = (block: ContentBlock): ContentBlock => {
    if (block.type === 'thinking') {
        return { ...block };
    }

    if (block.type === 'tool_call') {
        return {
            ...block,
            input: { ...block.input },
            output: block.output
                ? {
                    ...block.output,
                    structured: block.output.structured ? { ...block.output.structured } : undefined,
                }
                : undefined,
        };
    }

    return { ...block };
};

const cloneAssistantMessage = (message: AssistantMessage): AssistantMessage => ({
    ...message,
    blocks: message.blocks.map(cloneBlock),
});

const clonePiWorkUnit = (unit: PiWorkUnit): PiWorkUnit => {
    if (unit.kind === 'reasoning') {
        return { ...unit };
    }

    return {
        ...unit,
        input: { ...unit.input },
        output: unit.output
            ? {
                ...unit.output,
                structured: unit.output.structured ? { ...unit.output.structured } : undefined,
            }
            : undefined,
    };
};

export const cloneAssistantContentProjection = (projection: AssistantContentProjection): AssistantContentProjection => ({
    approvalBlock: projection.approvalBlock ? cloneBlock(projection.approvalBlock) as AssistantContentProjection['approvalBlock'] : null,
    assistantMessages: projection.assistantMessages.map(cloneAssistantMessage),
    timeline: projection.timeline.map((item) => {
        if (item.kind === 'assistant_message') {
            return {
                ...item,
                assistantMessage: cloneAssistantMessage(item.assistantMessage),
            };
        }

        if (item.kind === 'work_unit') {
            return {
                ...item,
                workUnit: clonePiWorkUnit(item.workUnit),
            };
        }

        return { ...item };
    }),
    workUnits: projection.workUnits.map(clonePiWorkUnit),
});

export const createEmptyAssistantContentProjection = (): AssistantContentProjection => ({
    approvalBlock: null,
    assistantMessages: [],
    timeline: [],
    workUnits: [],
});

export const appendProjectionMessage = (
    currentProjection: AssistantContentProjection | null | undefined,
    message: {
        content: string;
        createdAt: string | null;
        id: string;
        role: string;
        sourceMessageId?: string | null;
    },
): AssistantContentProjection => {
    const projection = cloneAssistantContentProjection(currentProjection ?? createEmptyAssistantContentProjection());
    const nextItem = {
        content: message.content,
        createdAt: message.createdAt,
        id: message.id,
        kind: 'message' as const,
        role: message.role,
        sourceMessageId: message.sourceMessageId ?? null,
    };
    const existingIndex = projection.timeline.findIndex((item) => item.kind === 'message' && item.id === message.id);

    if (existingIndex >= 0) {
        projection.timeline[existingIndex] = nextItem;
        return projection;
    }

    projection.timeline.push(nextItem);
    return projection;
};

const ensureAssistantMessage = (
    projection: AssistantContentProjection,
    item: PiAssistantMessageLifecycleItem,
) => {
    const existingIndex = projection.assistantMessages.findIndex((message) => message.id === item.itemId);

    if (existingIndex >= 0) {
        const existing = projection.assistantMessages[existingIndex];
        projection.assistantMessages[existingIndex] = {
            ...existing,
            assistantSegmentId: item.assistantSegmentId ?? existing.assistantSegmentId,
            createdAt: item.createdAt ?? existing.createdAt,
            model: item.model ?? existing.model,
            providerId: item.providerId ?? existing.providerId,
            runId: item.runId ?? existing.runId,
            sourceMessageId: item.sourceMessageId ?? existing.sourceMessageId,
            status: item.status,
            usage: item.usage ?? existing.usage,
        };

        return projection.assistantMessages[existingIndex];
    }

    const assistantMessage: AssistantMessage = {
        assistantSegmentId: item.assistantSegmentId ?? null,
        blocks: [],
        createdAt: item.createdAt,
        id: item.itemId,
        model: item.model ?? null,
        providerId: item.providerId ?? null,
        role: 'assistant',
        runId: item.runId ?? null,
        sourceMessageId: item.sourceMessageId ?? null,
        status: item.status,
        usage: item.usage,
    };

    projection.assistantMessages.push(assistantMessage);
    projection.timeline.push({
        assistantMessage,
        createdAt: assistantMessage.createdAt,
        id: assistantMessage.id,
        kind: 'assistant_message',
        sourceMessageId: assistantMessage.sourceMessageId ?? null,
    });

    return assistantMessage;
};

const syncTimelineAssistantMessage = (
    projection: AssistantContentProjection,
    message: AssistantMessage,
) => {
    const timelineIndex = projection.timeline.findIndex((item) => item.kind === 'assistant_message' && item.id === message.id);

    if (timelineIndex >= 0) {
        const currentItem = projection.timeline[timelineIndex];

        if (!currentItem || currentItem.kind !== 'assistant_message') {
            return;
        }

        projection.timeline[timelineIndex] = {
            ...currentItem,
            assistantMessage: message,
        };
    }
};

const createWorkUnit = (item: PiReasoningLifecycleItem | PiToolCallLifecycleItem): PiWorkUnit => {
    if (item.kind === 'reasoning') {
        return {
            content: '',
            createdAt: item.createdAt,
            durationMs: item.durationMs ?? null,
            id: item.itemId,
            kind: 'reasoning',
            runId: item.runId ?? null,
            sourceMessageId: item.sourceMessageId ?? null,
            status: item.status,
            summary: item.summary,
        };
    }

    return {
        createdAt: item.createdAt,
        durationMs: item.durationMs ?? null,
        errorMessage: item.errorMessage ?? null,
        finishedAt: item.finishedAt ?? null,
        id: item.itemId,
        input: { ...item.input },
        kind: 'tool_call',
        output: item.output
            ? {
                ...item.output,
                structured: item.output.structured ? { ...item.output.structured } : undefined,
            }
            : undefined,
        runId: item.runId ?? null,
        sourceMessageId: item.sourceMessageId ?? null,
        startedAt: item.startedAt ?? null,
        status: item.status,
        toolLabel: item.toolLabel,
        toolName: item.toolName,
    };
};

const mergeWorkUnit = (current: PiWorkUnit, item: PiReasoningLifecycleItem | PiToolCallLifecycleItem): PiWorkUnit => {
    if (item.kind === 'reasoning' && current.kind === 'reasoning') {
        return {
            ...current,
            createdAt: item.createdAt ?? current.createdAt,
            durationMs: item.durationMs ?? current.durationMs,
            runId: item.runId ?? current.runId,
            sourceMessageId: item.sourceMessageId ?? current.sourceMessageId,
            status: item.status,
            summary: item.summary ?? current.summary,
        };
    }

    if (item.kind === 'tool_call' && current.kind === 'tool_call') {
        return {
            ...current,
            createdAt: item.createdAt ?? current.createdAt,
            durationMs: item.durationMs ?? current.durationMs,
            errorMessage: item.errorMessage ?? current.errorMessage,
            finishedAt: item.finishedAt ?? current.finishedAt,
            input: { ...current.input, ...item.input },
            output: item.output
                ? {
                    ...item.output,
                    structured: item.output.structured ? { ...item.output.structured } : undefined,
                }
                : current.output,
            runId: item.runId ?? current.runId,
            sourceMessageId: item.sourceMessageId ?? current.sourceMessageId,
            startedAt: item.startedAt ?? current.startedAt,
            status: item.status,
            toolLabel: item.toolLabel,
            toolName: item.toolName,
        };
    }

    return createWorkUnit(item);
};

const ensureWorkUnit = (
    projection: AssistantContentProjection,
    item: PiReasoningLifecycleItem | PiToolCallLifecycleItem,
) => {
    const existingIndex = projection.workUnits.findIndex((unit) => unit.id === item.itemId);

    if (existingIndex >= 0) {
        const merged = mergeWorkUnit(projection.workUnits[existingIndex], item);
        projection.workUnits[existingIndex] = merged;
        return merged;
    }

    const nextUnit = createWorkUnit(item);
    projection.workUnits.push(nextUnit);
    projection.timeline.push({
        createdAt: nextUnit.createdAt,
        id: nextUnit.id,
        kind: 'work_unit',
        sourceMessageId: nextUnit.sourceMessageId ?? null,
        workUnit: nextUnit,
    });
    return nextUnit;
};

const syncTimelineWorkUnit = (
    projection: AssistantContentProjection,
    unit: PiWorkUnit,
) => {
    const timelineIndex = projection.timeline.findIndex((item) => item.kind === 'work_unit' && item.id === unit.id);

    if (timelineIndex >= 0) {
        const currentItem = projection.timeline[timelineIndex];

        if (!currentItem || currentItem.kind !== 'work_unit') {
            return;
        }

        projection.timeline[timelineIndex] = {
            ...currentItem,
            workUnit: unit,
        };
    }
};

const ensureAssistantTextBlock = (message: AssistantMessage) => {
    const blockId = buildContentBlockId({
        index: 0,
        kind: 'text',
        messageId: message.id,
        phase: 'assistant',
    });
    const existingIndex = message.blocks.findIndex((block) => block.id === blockId);

    if (existingIndex >= 0) {
        const block = message.blocks[existingIndex];

        if (block.type === 'text') {
            return block;
        }
    }

    const textBlock: ContentBlock = {
        content: '',
        id: blockId,
        status: 'streaming',
        type: 'text',
    };
    message.blocks = [...message.blocks.filter((block) => block.id !== blockId), textBlock];
    return textBlock;
};

const finalizeAssistantBlocks = (message: AssistantMessage) => {
    message.blocks = message.blocks.map((block) => {
        if (block.type === 'text' && block.status === 'streaming') {
            return {
                ...block,
                status: 'complete',
            };
        }

        return block;
    });
};

export const reducePiItemEvents = (
    currentProjection: AssistantContentProjection | null | undefined,
    events: PiItemEvent[] | undefined,
): AssistantContentProjection => {
    const projection = cloneAssistantContentProjection(currentProjection ?? createEmptyAssistantContentProjection());

    if (!events || events.length === 0) {
        return projection;
    }

    for (const event of events) {
        if (event.event === 'item.started' || event.event === 'item.updated' || event.event === 'item.completed') {
            if (event.data.kind === 'assistant_message') {
                const message = ensureAssistantMessage(projection, event.data);

                if (event.event === 'item.completed') {
                    finalizeAssistantBlocks(message);
                }

                syncTimelineAssistantMessage(projection, message);
                continue;
            }

            const workUnit = ensureWorkUnit(projection, event.data);
            syncTimelineWorkUnit(projection, workUnit);
            continue;
        }

        if (event.data.contentKind === 'reasoning') {
            const workUnit = ensureWorkUnit(projection, {
                createdAt: null,
                itemId: event.data.itemId,
                kind: 'reasoning',
                status: 'streaming',
            });

            if (workUnit.kind === 'reasoning') {
                workUnit.content = `${workUnit.content}${event.data.delta}`;
                workUnit.status = 'streaming';
                if (!workUnit.summary) {
                    const firstLine = workUnit.content.trim().split(/\r?\n/, 1)[0] ?? '';
                    workUnit.summary = firstLine.trim().length > 0 ? firstLine.trim() : undefined;
                }
            }

            syncTimelineWorkUnit(projection, workUnit);
            continue;
        }

        const message = ensureAssistantMessage(projection, {
            createdAt: null,
            itemId: event.data.itemId,
            kind: 'assistant_message',
            status: 'streaming',
        });
        const block = ensureAssistantTextBlock(message);

        if (block.type === 'text') {
            block.content = `${block.content}${event.data.delta}`;
            block.status = 'streaming';
        }

        message.status = 'streaming';
        syncTimelineAssistantMessage(projection, message);
    }

    return projection;
};