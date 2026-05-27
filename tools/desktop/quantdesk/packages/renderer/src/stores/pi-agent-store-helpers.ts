import { computePlaceholderConversationTitle } from '@quantdesk/shared';

import type {
    PiAgentStreamEvent,
    PiRunStatus,
    PiRuntimeStatus,
    PiSessionRecord,
    PiSessionSummary,
    PiSessionTranscript,
    PiToolStep,
} from '@quantdesk/shared';
import {
    createEmptyAssistantContentProjection,
    reducePiItemEvents,
} from '@quantdesk/shared';

export interface PiAgentStoreStateSlice {
    activeSessionId: string | null;
    errorMessage: string | null;
    noticeMessage: string | null;
    runtimeStatus: PiRuntimeStatus | null;
    sessionRecords: Record<string, PiSessionRecord>;
    sessionRuns: Record<string, PiRunStatus>;
    sessionHistoryOrder: string[];
    sessions: PiSessionSummary[];
}

export const createEmptyTranscript = (sessionId: string): PiSessionTranscript => ({
    cwd: '',
    messages: [],
    model: null,
    path: '',
    sessionId,
    thinkingLevel: 'balanced',
});

export const createEmptyRunStatus = (sessionId: string, updatedAt = new Date().toISOString()): PiRunStatus => ({
    currentTool: null,
    degraded: false,
    degradedReason: null,
    lastError: null,
    runId: null,
    sessionId,
    state: 'idle',
    updatedAt,
});

export const normalizeError = (error: unknown) => error instanceof Error ? error.message : '发生未知错误。';

export const sortSessions = (sessions: PiSessionSummary[]) => [...sessions].sort(
    (left, right) => right.updatedAt.localeCompare(left.updatedAt),
);

const normalizeHistoryOrder = (historyOrder: string[]) => (
    Array.from(new Set(historyOrder.map((id) => id.trim()).filter((id) => id.length > 0)))
);

export const parseSessionHistoryOrder = (value: string | null) => {
    if (!value) {
        return [];
    }

    try {
        const parsed = JSON.parse(value);

        if (!Array.isArray(parsed)) {
            return [];
        }

        return normalizeHistoryOrder(parsed.filter((item): item is string => typeof item === 'string'));
    } catch (error) {
        if (!(error instanceof SyntaxError)) {
            throw error;
        }

        return [];
    }
};

export const serializeSessionHistoryOrder = (historyOrder: string[]) =>
    JSON.stringify(normalizeHistoryOrder(historyOrder));

export const prependSessionHistoryId = (historyOrder: string[], sessionId: string) =>
    [sessionId, ...historyOrder.filter((id) => id !== sessionId)];

export const sortSessionsByHistoryOrder = (sessions: PiSessionSummary[], historyOrder: string[]) => {
    if (historyOrder.length === 0) {
        return sortSessions(sessions);
    }

    const orderIndex = new Map(historyOrder.map((id, index) => [id, index]));

    return [...sessions].sort((left, right) => {
        const leftIndex = orderIndex.get(left.id);
        const rightIndex = orderIndex.get(right.id);

        if (leftIndex != null && rightIndex != null) {
            return leftIndex - rightIndex;
        }

        if (leftIndex != null) {
            return -1;
        }

        if (rightIndex != null) {
            return 1;
        }

        return right.updatedAt.localeCompare(left.updatedAt);
    });
};

export const upsertSessionSummaryByHistoryOrder = (
    sessions: PiSessionSummary[],
    summary: PiSessionSummary,
    historyOrder: string[],
) => sortSessionsByHistoryOrder(
    [summary, ...sessions.filter((session) => session.id !== summary.id)],
    historyOrder,
);

export const upsertSessionSummary = (
    sessions: PiSessionSummary[],
    summary: PiSessionSummary,
) => sortSessions([
    summary,
    ...sessions.filter((session) => session.id !== summary.id),
]);

export const readPreviewFromTranscript = (transcript: PiSessionTranscript) => {
    const firstMessage = transcript.messages.find((message) => (
        message.role === 'user'
        || (message.role === 'assistant' && message.phase !== 'thinking')
    )) ?? transcript.messages.find((message) => message.role === 'assistant');

    return firstMessage?.content ?? '';
};

export const buildSkeletonSession = (
    sessionId: string,
    summary?: Partial<PiSessionSummary>,
): PiSessionRecord => ({
    cwd: summary?.cwd ?? '',
    degraded: summary?.degraded ?? false,
    degradedReason: summary?.degradedReason ?? null,
    id: sessionId,
    lastError: summary?.lastError ?? null,
    lastToolName: summary?.lastToolName ?? null,
    preview: summary?.preview ?? '',
    projection: createEmptyAssistantContentProjection(),
    runState: summary?.runState ?? 'idle',
    runStatus: createEmptyRunStatus(sessionId),
    title: summary?.title ?? null,
    titleSource: summary?.titleSource ?? 'placeholder',
    titleStatus: summary?.titleStatus ?? 'ready',
    titleUpdatedAt: summary?.titleUpdatedAt ?? null,
    toolSteps: [],
    transcript: createEmptyTranscript(sessionId),
    updatedAt: summary?.updatedAt ?? new Date().toISOString(),
});

export const buildSummaryFromRecord = (record: PiSessionRecord): PiSessionSummary => ({
    cwd: record.cwd,
    degraded: record.degraded,
    degradedReason: record.degradedReason,
    id: record.id,
    lastError: record.runStatus?.lastError ?? record.lastError,
    lastToolName: record.runStatus?.currentTool ?? record.lastToolName,
    preview: record.preview,
    runState: record.runStatus?.state ?? record.runState,
    title: record.title,
    titleSource: record.titleSource,
    titleStatus: record.titleStatus,
    titleUpdatedAt: record.titleUpdatedAt,
    updatedAt: record.updatedAt,
});

const mergeSessionRecordWithSummary = (
    currentRecord: PiSessionRecord,
    summary: PiSessionSummary,
): PiSessionRecord => ({
    ...currentRecord,
    ...summary,
    preview: summary.preview || currentRecord.preview,
    title: summary.title ?? currentRecord.title,
    titleSource: summary.titleSource ?? currentRecord.titleSource,
    titleStatus: summary.titleStatus ?? currentRecord.titleStatus,
    titleUpdatedAt: summary.titleUpdatedAt ?? currentRecord.titleUpdatedAt,
});

const resolveProjection = (
    currentRecord: PiSessionRecord,
    payload: PiAgentStreamEvent,
) => payload.projection
    ?? reducePiItemEvents(currentRecord.projection, payload.itemEvents);

export const appendAssistantDelta = (
    record: PiSessionRecord,
    payload: { delta: string; messageId: string; phase: 'assistant' | 'thinking'; timestamp: string },
): PiSessionRecord => {
    const nextMessages = [...record.transcript.messages];
    const messageIndex = nextMessages.findIndex((message) => message.id === payload.messageId && message.phase === payload.phase);

    if (messageIndex < 0) {
        nextMessages.push({
            content: payload.delta,
            id: payload.messageId,
            phase: payload.phase,
            role: 'assistant',
        });
    } else {
        nextMessages[messageIndex] = {
            ...nextMessages[messageIndex],
            content: `${nextMessages[messageIndex].content}${payload.delta}`,
            phase: payload.phase,
        };
    }

    const preview = record.preview || readPreviewFromTranscript({ ...record.transcript, messages: nextMessages });

    return {
        ...record,
        preview,
        transcript: {
            ...record.transcript,
            messages: nextMessages,
        },
        updatedAt: payload.timestamp,
    };
};

export const upsertToolStep = (steps: PiToolStep[], step: PiToolStep) => {
    const index = steps.findIndex((item) => item.toolCallId === step.toolCallId);

    if (index < 0) {
        return [...steps, step];
    }

    const nextSteps = [...steps];
    nextSteps[index] = {
        ...nextSteps[index],
        ...step,
        startedAt: nextSteps[index].startedAt ?? step.startedAt,
    };

    return nextSteps;
};

const getSessionIdFromStreamEvent = (payload: PiAgentStreamEvent) => {
    switch (payload.type) {
        case 'session_created':
        case 'session_updated':
            return payload.session.id;
        case 'run_started':
        case 'run_failed':
        case 'run_cancelled':
            return payload.status.sessionId;
        case 'run_completed':
            return payload.transcript.sessionId;
        case 'message_delta':
            return payload.sessionId;
        case 'tool_execution_start':
        case 'tool_execution_update':
        case 'tool_execution_end':
            return payload.step.sessionId;
        case 'diagnostics_updated':
            return null;
    }
};

export const reducePiAgentStreamEvent = (
    state: PiAgentStoreStateSlice,
    payload: PiAgentStreamEvent,
): Partial<PiAgentStoreStateSlice> => {
    if (payload.type === 'diagnostics_updated') {
        return { runtimeStatus: payload.status };
    }

    const sessionId = getSessionIdFromStreamEvent(payload);

    if (!sessionId) {
        return {};
    }

    const currentRecord = state.sessionRecords[sessionId]
        ?? buildSkeletonSession(sessionId);
    const currentRun = state.sessionRuns[sessionId] ?? currentRecord.runStatus ?? createEmptyRunStatus(sessionId);

    if (payload.type === 'session_created') {
        const nextRecord: PiSessionRecord = {
            ...mergeSessionRecordWithSummary(currentRecord, payload.session),
            projection: resolveProjection(currentRecord, payload),
            runStatus: currentRecord.runStatus ?? currentRun,
        };

        return {
            activeSessionId: state.activeSessionId ?? sessionId,
            sessionRecords: {
                ...state.sessionRecords,
                [sessionId]: nextRecord,
            },
            sessions: upsertSessionSummaryByHistoryOrder(
                state.sessions,
                buildSummaryFromRecord(nextRecord),
                state.sessionHistoryOrder,
            ),
        };
    }

    if (payload.type === 'session_updated') {
        const nextRecord: PiSessionRecord = {
            ...mergeSessionRecordWithSummary(currentRecord, payload.session),
            projection: resolveProjection(currentRecord, payload),
            runStatus: currentRecord.runStatus ?? currentRun,
        };

        return {
            sessionRecords: {
                ...state.sessionRecords,
                [sessionId]: nextRecord,
            },
            sessions: upsertSessionSummaryByHistoryOrder(
                state.sessions,
                buildSummaryFromRecord(nextRecord),
                state.sessionHistoryOrder,
            ),
        };
    }

    if (payload.type === 'run_started') {
        const nextRecord = {
            ...currentRecord,
            lastError: null,
            projection: resolveProjection(currentRecord, payload),
            runState: payload.status.state,
            runStatus: payload.status,
            updatedAt: payload.timestamp,
        };

        return {
            noticeMessage: payload.message,
            sessionRecords: {
                ...state.sessionRecords,
                [sessionId]: nextRecord,
            },
            sessionRuns: {
                ...state.sessionRuns,
                [sessionId]: payload.status,
            },
            sessions: upsertSessionSummaryByHistoryOrder(
                state.sessions,
                buildSummaryFromRecord(nextRecord),
                state.sessionHistoryOrder,
            ),
        };
    }

    if (payload.type === 'message_delta') {
        const nextRecord = appendAssistantDelta(currentRecord, payload);
        const nextRun: PiRunStatus = {
            ...currentRun,
            runId: payload.runId,
            state: 'running',
            updatedAt: payload.timestamp,
        };

        return {
            sessionRecords: {
                ...state.sessionRecords,
                [sessionId]: {
                    ...nextRecord,
                    projection: resolveProjection(currentRecord, payload),
                    runState: nextRun.state,
                    runStatus: nextRun,
                },
            },
            sessionRuns: {
                ...state.sessionRuns,
                [sessionId]: nextRun,
            },
            sessions: upsertSessionSummaryByHistoryOrder(
                state.sessions,
                buildSummaryFromRecord({
                    ...nextRecord,
                    runState: nextRun.state,
                    runStatus: nextRun,
                }),
                state.sessionHistoryOrder,
            ),
        };
    }

    if (
        payload.type === 'tool_execution_start'
        || payload.type === 'tool_execution_update'
        || payload.type === 'tool_execution_end'
    ) {
        const nextToolSteps = upsertToolStep(currentRecord.toolSteps, payload.step);
        const nextRun: PiRunStatus = {
            ...currentRun,
            currentTool: payload.step.toolName,
            lastError: payload.step.error?.message ?? currentRun.lastError,
            runId: payload.step.runId,
            state: payload.step.status === 'error' ? 'failed' : 'running',
            updatedAt: payload.timestamp,
        };
        const nextRecord: PiSessionRecord = {
            ...currentRecord,
            lastError: nextRun.lastError,
            lastToolName: payload.step.toolName,
            projection: resolveProjection(currentRecord, payload),
            runState: nextRun.state,
            runStatus: nextRun,
            toolSteps: nextToolSteps,
            updatedAt: payload.timestamp,
        };

        return {
            sessionRecords: {
                ...state.sessionRecords,
                [sessionId]: nextRecord,
            },
            sessionRuns: {
                ...state.sessionRuns,
                [sessionId]: nextRun,
            },
            sessions: upsertSessionSummaryByHistoryOrder(
                state.sessions,
                buildSummaryFromRecord(nextRecord),
                state.sessionHistoryOrder,
            ),
        };
    }

    if (payload.type === 'run_completed') {
        const preview = readPreviewFromTranscript(payload.transcript);
        const nextRecord = {
            ...currentRecord,
            preview,
            projection: resolveProjection(currentRecord, payload),
            runState: payload.status.state,
            runStatus: payload.status,
            title: payload.session?.title
                ?? currentRecord.title
                ?? computePlaceholderConversationTitle(preview),
            titleSource: payload.session?.titleSource ?? currentRecord.titleSource,
            titleStatus: payload.session?.titleStatus ?? currentRecord.titleStatus,
            titleUpdatedAt: payload.session?.titleUpdatedAt ?? currentRecord.titleUpdatedAt,
            transcript: payload.transcript,
            updatedAt: payload.timestamp,
        };

        return {
            noticeMessage: 'Agent 运行已完成。',
            sessionRecords: {
                ...state.sessionRecords,
                [sessionId]: nextRecord,
            },
            sessionRuns: {
                ...state.sessionRuns,
                [sessionId]: payload.status,
            },
            sessions: upsertSessionSummaryByHistoryOrder(
                state.sessions,
                buildSummaryFromRecord(nextRecord),
                state.sessionHistoryOrder,
            ),
        };
    }

    if (payload.type === 'run_failed') {
        const nextRecord = {
            ...currentRecord,
            lastError: payload.error,
            projection: resolveProjection(currentRecord, payload),
            runState: payload.status.state,
            runStatus: payload.status,
            title: payload.session?.title ?? currentRecord.title,
            titleSource: payload.session?.titleSource ?? currentRecord.titleSource,
            titleStatus: payload.session?.titleStatus ?? currentRecord.titleStatus,
            titleUpdatedAt: payload.session?.titleUpdatedAt ?? currentRecord.titleUpdatedAt,
            updatedAt: payload.timestamp,
        };

        return {
            errorMessage: payload.error,
            sessionRecords: {
                ...state.sessionRecords,
                [sessionId]: nextRecord,
            },
            sessionRuns: {
                ...state.sessionRuns,
                [sessionId]: payload.status,
            },
            sessions: upsertSessionSummaryByHistoryOrder(
                state.sessions,
                buildSummaryFromRecord(nextRecord),
                state.sessionHistoryOrder,
            ),
        };
    }

    const nextRecord = {
        ...currentRecord,
        projection: resolveProjection(currentRecord, payload),
        runState: payload.status.state,
        runStatus: payload.status,
        title: payload.session?.title ?? currentRecord.title,
        titleSource: payload.session?.titleSource ?? currentRecord.titleSource,
        titleStatus: payload.session?.titleStatus ?? currentRecord.titleStatus,
        titleUpdatedAt: payload.session?.titleUpdatedAt ?? currentRecord.titleUpdatedAt,
        updatedAt: payload.timestamp,
    };

    return {
        noticeMessage: 'Agent 运行已取消。',
        sessionRecords: {
            ...state.sessionRecords,
            [sessionId]: nextRecord,
        },
        sessionRuns: {
            ...state.sessionRuns,
            [sessionId]: payload.status,
        },
        sessions: upsertSessionSummaryByHistoryOrder(
            state.sessions,
            buildSummaryFromRecord(nextRecord),
            state.sessionHistoryOrder,
        ),
    };
};
