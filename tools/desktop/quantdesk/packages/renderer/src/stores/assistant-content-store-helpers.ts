import type {
    AssistantContentProjection,
    AssistantMessage,
    ContentBlock,
    NormalizedStreamEvent,
} from '@quantdesk/shared';
import {
    cloneAssistantContentProjection,
    createEmptyAssistantContentProjection,
} from '@quantdesk/shared';

export {
    appendProjectionMessage,
    cloneAssistantContentProjection,
    createEmptyAssistantContentProjection,
} from '@quantdesk/shared';

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

const ensureAssistantMessage = (
    projection: AssistantContentProjection,
    messageId: string,
    metadata?: { model?: string | null; providerId?: string | null },
) => {
    const existingIndex = projection.assistantMessages.findIndex((message) => message.id === messageId);

    if (existingIndex >= 0) {
        const existing = projection.assistantMessages[existingIndex];
        projection.assistantMessages[existingIndex] = {
            ...existing,
            model: metadata?.model ?? existing.model,
            providerId: metadata?.providerId ?? existing.providerId,
        };

        const timelineIndex = projection.timeline.findIndex((item) => item.kind === 'assistant_message' && item.id === messageId);

        if (timelineIndex >= 0) {
            projection.timeline[timelineIndex] = {
                ...projection.timeline[timelineIndex],
                assistantMessage: projection.assistantMessages[existingIndex],
            } as typeof projection.timeline[number];
        }

        return projection.assistantMessages[existingIndex];
    }

    const nextMessage: AssistantMessage = {
        blocks: [],
        createdAt: null,
        id: messageId,
        model: metadata?.model ?? null,
        providerId: metadata?.providerId ?? null,
        role: 'assistant',
        status: 'streaming',
    };

    projection.assistantMessages.push(nextMessage);
    projection.timeline.push({
        assistantMessage: nextMessage,
        createdAt: null,
        id: messageId,
        kind: 'assistant_message',
        sourceMessageId: nextMessage.sourceMessageId ?? null,
    });

    return nextMessage;
};

const upsertBlock = (message: AssistantMessage, block: ContentBlock) => {
    const existingIndex = message.blocks.findIndex((candidate) => candidate.id === block.id);

    if (existingIndex >= 0) {
        const existing = message.blocks[existingIndex];
        message.blocks[existingIndex] = cloneBlock({
            ...existing,
            ...block,
        } as ContentBlock);
        return message.blocks[existingIndex];
    }

    const nextBlock = cloneBlock(block);
    message.blocks.push(nextBlock);
    return nextBlock;
};

const ensureFallbackBlock = (message: AssistantMessage, blockId: string, event: NormalizedStreamEvent) => {
    const existing = message.blocks.find((block) => block.id === blockId);

    if (existing) {
        return existing;
    }

    if (event.event === 'block_delta') {
        if (event.data.delta.type === 'thinking_delta') {
            return upsertBlock(message, {
                content: '',
                id: blockId,
                status: 'streaming',
                type: 'thinking',
            });
        }

        if (event.data.delta.type === 'text_delta') {
            return upsertBlock(message, {
                content: '',
                id: blockId,
                status: 'streaming',
                type: 'text',
            });
        }

        return upsertBlock(message, {
            id: blockId,
            input: {},
            status: 'running',
            toolLabel: '工具调用',
            toolName: 'unknown_tool',
            type: 'tool_call',
        });
    }

    return upsertBlock(message, {
        id: blockId,
        input: {},
        status: 'running',
        toolLabel: '工具调用',
        toolName: 'unknown_tool',
        type: 'tool_call',
    });
};

const completeStreamingNarrativeBlocks = (message: AssistantMessage, activeBlockId: string) => {
    for (const block of message.blocks) {
        if (block.id === activeBlockId) {
            continue;
        }

        if ((block.type === 'thinking' || block.type === 'text') && block.status === 'streaming') {
            block.status = 'complete';
        }
    }
};

const finalizeStreamingBlocks = (message: AssistantMessage) => {
    for (const block of message.blocks) {
        if ((block.type === 'thinking' || block.type === 'text') && block.status === 'streaming') {
            block.status = 'complete';
        }
    }
};

const syncTimelineAssistantMessage = (projection: AssistantContentProjection, messageId: string, message: AssistantMessage) => {
    const timelineIndex = projection.timeline.findIndex((item) => item.kind === 'assistant_message' && item.id === messageId);

    if (timelineIndex >= 0) {
        projection.timeline[timelineIndex] = {
            ...projection.timeline[timelineIndex],
            assistantMessage: message,
        } as typeof projection.timeline[number];
    }
};

export const reduceNormalizedStreamEvents = (
    currentProjection: AssistantContentProjection | null | undefined,
    events: NormalizedStreamEvent[] | undefined,
): AssistantContentProjection => {
    const projection = cloneAssistantContentProjection(currentProjection ?? createEmptyAssistantContentProjection());

    if (!events || events.length === 0) {
        return projection;
    }

    for (const event of events) {
        if (event.event === 'message_start') {
            ensureAssistantMessage(projection, event.data.messageId, {
                model: event.data.model,
                providerId: event.data.providerId,
            });
            continue;
        }

        if (event.event === 'block_start') {
            const message = ensureAssistantMessage(projection, event.data.messageId);
            const hasExistingBlock = message.blocks.some((block) => block.id === event.data.block.id);

            if (!hasExistingBlock) {
                completeStreamingNarrativeBlocks(message, event.data.block.id);
            }

            upsertBlock(message, event.data.block);
            syncTimelineAssistantMessage(projection, message.id, message);
            continue;
        }

        if (event.event === 'block_delta') {
            const message = ensureAssistantMessage(projection, event.data.messageId);
            const block = ensureFallbackBlock(message, event.data.blockId, event);

            if (event.data.delta.type === 'thinking_delta' && block.type === 'thinking') {
                block.content = `${block.content}${event.data.delta.text}`;
                block.status = 'streaming';
            }

            if (event.data.delta.type === 'text_delta' && block.type === 'text') {
                block.content = `${block.content}${event.data.delta.text}`;
                block.status = 'streaming';
            }

            if (event.data.delta.type === 'tool_call_delta' && block.type === 'tool_call') {
                const nextContent = event.data.delta.outputDelta?.trim();

                if (nextContent) {
                    block.output = {
                        content: block.output?.content
                            ? `${block.output.content}\n${nextContent}`
                            : nextContent,
                        summary: nextContent,
                    };
                }
            }

            if (event.data.delta.type === 'tool_status_change' && block.type === 'tool_call') {
                block.status = event.data.delta.status;
            }

            syncTimelineAssistantMessage(projection, message.id, message);
            continue;
        }

        if (event.event === 'block_end') {
            const message = ensureAssistantMessage(projection, event.data.messageId);
            const block = ensureFallbackBlock(message, event.data.blockId, event);

            if (block.type === 'thinking') {
                block.status = event.data.status === 'streaming' ? 'streaming' : 'complete';
            }

            if (block.type === 'text') {
                block.status = event.data.status === 'streaming' ? 'streaming' : 'complete';
            }

            if (block.type === 'tool_call') {
                block.status = event.data.status as typeof block.status;
            }

            syncTimelineAssistantMessage(projection, message.id, message);
            continue;
        }

        if (event.event === 'message_end') {
            const message = ensureAssistantMessage(projection, event.data.messageId);
            finalizeStreamingBlocks(message);
            message.status = event.data.status;
            message.usage = event.data.usage;
            syncTimelineAssistantMessage(projection, message.id, message);
            continue;
        }

        const message = ensureAssistantMessage(projection, event.data.messageId);
        upsertBlock(message, {
            code: event.data.code,
            id: `${event.data.messageId}:error`,
            message: event.data.message,
            type: 'error',
        });
        message.status = 'error';
        syncTimelineAssistantMessage(projection, message.id, message);
    }

    return projection;
};