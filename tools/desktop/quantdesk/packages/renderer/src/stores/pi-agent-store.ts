import { create } from 'zustand';

import type {
    PiAgentStreamEvent,
    PiRiskGateState,
    PiRunStatus,
    PiRuntimeDirectoryTarget,
    PiRuntimeStatus,
    PiSessionRecord,
    PiSessionSummary,
    PiSkillSummary,
    PiStagedAttachment,
} from '@quantdesk/shared';
import { appendProjectionMessage, computePlaceholderConversationTitle } from '@quantdesk/shared';

import { apiClient } from '../lib/api-client';
import {
    buildSkeletonSession,
    buildSummaryFromRecord,
    createEmptyRunStatus,
    normalizeError,
    parseSessionHistoryOrder,
    prependSessionHistoryId,
    reducePiAgentStreamEvent,
    sortSessionsByHistoryOrder,
    serializeSessionHistoryOrder,
    upsertSessionSummaryByHistoryOrder,
} from './pi-agent-store-helpers';

const sessionHistoryOrderStorageKey = 'pi.thread-history-order';

const formatAttachmentSize = (size: number) => {
    if (size >= 1024 * 1024) {
        return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    }

    if (size >= 1024) {
        return `${Math.ceil(size / 1024)} KB`;
    }

    return `${size} B`;
};

const formatDraftWithAttachments = (draft: string, attachments: PiStagedAttachment[]) => {
    if (attachments.length === 0) {
        return draft;
    }

    return [
        draft,
        '',
        '附件：',
        ...attachments.map((attachment) => `- ${attachment.name} (${attachment.kind === 'image' ? '图片' : '文档'}, ${formatAttachmentSize(attachment.size)})`),
    ].join('\n');
};

interface PiAgentStoreState {
    activeSessionId: string | null;
    draft: string;
    draftAttachments: PiStagedAttachment[];
    errorMessage: string | null;
    isBootstrapped: boolean;
    isLoadingSession: boolean;
    isLoadingSessions: boolean;
    isStagingAttachments: boolean;
    noticeMessage: string | null;
    riskGateState: PiRiskGateState | null;
    runtimeStatus: PiRuntimeStatus | null;
    sessionRecords: Record<string, PiSessionRecord>;
    sessionRuns: Record<string, PiRunStatus>;
    sessionHistoryOrder: string[];
    sessions: PiSessionSummary[];
    skills: PiSkillSummary[];
}

interface PiAgentStoreActions {
    acknowledgeHighPrivilegeRisk: () => Promise<boolean>;
    cancelRun: (sessionId?: string) => Promise<boolean>;
    clearNotice: () => void;
    deleteSession: (sessionId: string) => Promise<boolean>;
    initialize: () => Promise<void>;
    loadSession: (sessionId: string) => Promise<void>;
    loadSessions: () => Promise<void>;
    loadSkills: () => Promise<void>;
    openRuntimeDirectory: (target: PiRuntimeDirectoryTarget) => Promise<boolean>;
    refreshRuntimeStatus: () => Promise<void>;
    removeDraftAttachment: (attachmentId: string) => Promise<void>;
    sendMessage: () => Promise<boolean>;
    setActiveSessionId: (sessionId: string | null) => void;
    setSessionHistoryOrder: (historyOrder: string[]) => Promise<void>;
    setDraft: (value: string) => void;
    stageAttachments: () => Promise<boolean>;
    startNewSession: () => void;
}

export type PiAgentStore = PiAgentStoreState & PiAgentStoreActions;

let streamUnsubscribe: (() => void) | null = null;

export const usePiAgentStore = create<PiAgentStore>((set, get) => ({
    activeSessionId: null,
    draft: '',
    draftAttachments: [],
    errorMessage: null,
    isBootstrapped: false,
    isLoadingSession: false,
    isLoadingSessions: false,
    isStagingAttachments: false,
    noticeMessage: null,
    riskGateState: null,
    runtimeStatus: null,
    sessionHistoryOrder: [],
    sessionRecords: {},
    sessionRuns: {},
    sessions: [],
    skills: [],
    async acknowledgeHighPrivilegeRisk() {
        try {
            const riskGateState = await apiClient.piRuntime.acknowledgeHighPrivilegeRisk();
            set({ noticeMessage: '已确认 Agent 高权限风险。', riskGateState });
            return true;
        } catch (error) {
            set({ errorMessage: normalizeError(error) });
            return false;
        }
    },
    async cancelRun(sessionId) {
        const targetSessionId = sessionId ?? get().activeSessionId;

        if (!targetSessionId) {
            return false;
        }

        const currentRun = get().sessionRuns[targetSessionId] ?? get().sessionRecords[targetSessionId]?.runStatus;

        if (!currentRun?.runId) {
            return false;
        }

        try {
            await apiClient.piAgent.cancelRun({
                runId: currentRun.runId,
                sessionId: targetSessionId,
            });
            set({ noticeMessage: '已请求取消当前 Agent 运行。' });
            return true;
        } catch (error) {
            set({ errorMessage: normalizeError(error) });
            return false;
        }
    },
    clearNotice() {
        set({ errorMessage: null, noticeMessage: null });
    },
    async deleteSession(sessionId) {
        set({ errorMessage: null });

        try {
            const deleted = await apiClient.piAgent.deleteSession(sessionId);

            if (!deleted) {
                return false;
            }

            const nextSessions = get().sessions.filter((session) => session.id !== sessionId);
            const nextSessionHistoryOrder = get().sessionHistoryOrder.filter((conversationId) => conversationId !== sessionId);
            const nextActiveSessionId = get().activeSessionId === sessionId
                ? (nextSessions[0]?.id ?? null)
                : get().activeSessionId;

            set({
                activeSessionId: nextActiveSessionId,
                noticeMessage: 'Pi 会话已删除。',
                sessionHistoryOrder: nextSessionHistoryOrder,
                sessionRecords: Object.fromEntries(
                    Object.entries(get().sessionRecords).filter(([conversationId]) => conversationId !== sessionId),
                ),
                sessionRuns: Object.fromEntries(
                    Object.entries(get().sessionRuns).filter(([conversationId]) => conversationId !== sessionId),
                ),
                sessions: nextSessions,
            });

            if (get().sessionHistoryOrder.length !== nextSessionHistoryOrder.length) {
                void get().setSessionHistoryOrder(nextSessionHistoryOrder);
            }

            if (nextActiveSessionId) {
                if (!get().sessionRecords[nextActiveSessionId]) {
                    await get().loadSession(nextActiveSessionId);
                }

                await get().refreshRuntimeStatus();
            }

            await get().refreshRuntimeStatus();

            return true;
        } catch (error) {
            set({ errorMessage: normalizeError(error) });
            return false;
        }
    },
    async initialize() {
        if (!get().isBootstrapped) {
            streamUnsubscribe?.();
            streamUnsubscribe = apiClient.piAgent.onStream((payload: PiAgentStreamEvent) => {
                set((state) => reducePiAgentStreamEvent(state, payload));

                if (payload.type === 'run_completed' || payload.type === 'run_failed' || payload.type === 'run_cancelled') {
                    const targetSessionId = payload.type === 'run_completed'
                        ? payload.transcript.sessionId
                        : payload.status.sessionId;
                    void get().loadSession(targetSessionId);
                    void get().refreshRuntimeStatus();
                }
            });

            set({ isBootstrapped: true });
        }

        await Promise.all([get().loadSessions(), get().loadSkills(), get().refreshRuntimeStatus()]);
    },
    async loadSession(sessionId) {
        set({ errorMessage: null, isLoadingSession: true });

        try {
            const session = await apiClient.piAgent.getSession(sessionId);

            if (!session) {
                set({ isLoadingSession: false });
                return;
            }

            set({
                activeSessionId: sessionId,
                isLoadingSession: false,
                sessionRecords: {
                    ...get().sessionRecords,
                    [sessionId]: session,
                },
                sessionRuns: {
                    ...get().sessionRuns,
                    [sessionId]: session.runStatus ?? createEmptyRunStatus(sessionId, session.updatedAt),
                },
                sessions: upsertSessionSummaryByHistoryOrder(
                    get().sessions,
                    buildSummaryFromRecord(session),
                    get().sessionHistoryOrder,
                ),
            });
        } catch (error) {
            set({
                errorMessage: normalizeError(error),
                isLoadingSession: false,
            });
        }
    },
    async loadSessions() {
        set({ errorMessage: null, isLoadingSessions: true });

        try {
            const [historyOrderValue, sessionSummaries] = await Promise.all([
                apiClient.settings.get(sessionHistoryOrderStorageKey),
                apiClient.piAgent.listSessions(),
            ]);
            const sessionHistoryOrder = parseSessionHistoryOrder(historyOrderValue);
            const sessions = sortSessionsByHistoryOrder(sessionSummaries, sessionHistoryOrder);
            const nextActiveSessionId = get().activeSessionId ?? sessions[0]?.id ?? null;

            set({
                activeSessionId: nextActiveSessionId,
                sessionHistoryOrder,
                isLoadingSessions: false,
                sessions,
            });

            if (nextActiveSessionId && !get().sessionRecords[nextActiveSessionId]) {
                await get().loadSession(nextActiveSessionId);
            }
        } catch (error) {
            set({
                errorMessage: normalizeError(error),
                isLoadingSessions: false,
            });
        }
    },
    async loadSkills() {
        set({ errorMessage: null });

        try {
            const skills = await apiClient.piAgent.listSkills();
            set({ skills });
        } catch (error) {
            set({ errorMessage: normalizeError(error), skills: [] });
        }
    },
    async openRuntimeDirectory(target) {
        try {
            await apiClient.piRuntime.openDirectory(target);
            set({ noticeMessage: '已打开 Agent 运行目录。' });
            return true;
        } catch (error) {
            set({ errorMessage: normalizeError(error) });
            return false;
        }
    },
    async refreshRuntimeStatus() {
        try {
            const [runtimeStatus, riskGateState] = await Promise.all([
                apiClient.piRuntime.getStatus(),
                apiClient.piRuntime.getRiskGateState(),
            ]);

            set({ riskGateState, runtimeStatus });
        } catch (error) {
            set({ errorMessage: normalizeError(error) });
        }
    },
    async removeDraftAttachment(attachmentId) {
        set({
            draftAttachments: get().draftAttachments.filter((attachment) => attachment.id !== attachmentId),
        });

        try {
            await apiClient.piAgent.discardAttachments({ attachmentIds: [attachmentId] });
        } catch (error) {
            set({ errorMessage: normalizeError(error) });
        }
    },
    async sendMessage() {
        const draft = get().draft.trim();
        const draftAttachments = get().draftAttachments;
        const message = draft || (draftAttachments.length > 0 ? '请分析这些附件。' : '');
        const activeSessionId = get().activeSessionId;
        const currentRun = activeSessionId ? get().sessionRuns[activeSessionId] : null;

        if (!message || currentRun?.state === 'running') {
            return false;
        }

        if (!get().riskGateState?.acknowledged) {
            set({ errorMessage: '请先确认 Agent 的高权限风险。' });
            return false;
        }

        const previousRecord = activeSessionId ? get().sessionRecords[activeSessionId] ?? null : null;
        const previousSummary = activeSessionId
            ? get().sessions.find((session) => session.id === activeSessionId) ?? null
            : null;
        const displayDraft = formatDraftWithAttachments(message, draftAttachments);

        if (activeSessionId) {
            const optimisticRecord = (() => {
                const current = get().sessionRecords[activeSessionId] ?? buildSkeletonSession(activeSessionId);
                const now = new Date().toISOString();
                const optimisticUserMessageId = crypto.randomUUID();
                return {
                    ...current,
                    preview: current.preview || message,
                    projection: appendProjectionMessage(current.projection, {
                        content: displayDraft,
                        createdAt: now,
                        id: optimisticUserMessageId,
                        role: 'user',
                    }),
                    runState: 'running' as const,
                    runStatus: {
                        ...(current.runStatus ?? createEmptyRunStatus(activeSessionId, now)),
                        runId: current.runStatus?.runId ?? null,
                        state: 'running' as const,
                        updatedAt: now,
                    },
                    title: current.title ?? computePlaceholderConversationTitle(message),
                    titleSource: current.titleSource ?? 'placeholder',
                    titleStatus: current.titleStatus ?? 'pending',
                    titleUpdatedAt: current.titleUpdatedAt ?? now,
                    transcript: {
                        ...current.transcript,
                        messages: [...current.transcript.messages, {
                            content: displayDraft,
                            id: optimisticUserMessageId,
                            role: 'user',
                        }],
                    },
                    updatedAt: now,
                } satisfies PiSessionRecord;
            })();

            set({
                draft: '',
                draftAttachments: [],
                errorMessage: null,
                sessionRecords: {
                    ...get().sessionRecords,
                    [activeSessionId]: optimisticRecord,
                },
                sessionRuns: {
                    ...get().sessionRuns,
                    [activeSessionId]: optimisticRecord.runStatus ?? createEmptyRunStatus(activeSessionId, optimisticRecord.updatedAt),
                },
                sessions: upsertSessionSummaryByHistoryOrder(
                    get().sessions,
                    buildSummaryFromRecord(optimisticRecord),
                    get().sessionHistoryOrder,
                ),
            });
        } else {
            set({ errorMessage: null, noticeMessage: '正在创建新的 Pi 会话...' });
        }

        try {
            const response = await apiClient.piAgent.sendMessage({
                attachments: draftAttachments,
                message,
                sessionId: activeSessionId ?? undefined,
            });
            const optimisticNewRecord = !activeSessionId
                ? (() => {
                    const now = new Date().toISOString();
                    const optimisticUserMessageId = crypto.randomUUID();
                    const skeletonSession = buildSkeletonSession(response.sessionId);
                    return {
                        ...skeletonSession,
                        preview: message,
                        projection: appendProjectionMessage(skeletonSession.projection, {
                            content: displayDraft,
                            createdAt: now,
                            id: optimisticUserMessageId,
                            role: 'user',
                        }),
                        runState: 'running' as const,
                        runStatus: {
                            ...createEmptyRunStatus(response.sessionId, now),
                            runId: response.runId,
                            state: 'running' as const,
                            updatedAt: now,
                        },
                        title: computePlaceholderConversationTitle(message),
                        titleSource: 'placeholder' as const,
                        titleStatus: 'pending' as const,
                        titleUpdatedAt: now,
                        transcript: {
                            ...skeletonSession.transcript,
                            messages: [{
                                content: displayDraft,
                                id: optimisticUserMessageId,
                                role: 'user',
                            }],
                        },
                        updatedAt: now,
                    } satisfies PiSessionRecord;
                })()
                : null;
            const runStatus = {
                ...(get().sessionRuns[response.sessionId] ?? createEmptyRunStatus(response.sessionId)),
                runId: response.runId,
                state: 'running' as const,
                updatedAt: new Date().toISOString(),
            };

            set({
                activeSessionId: response.sessionId,
                draft: '',
                draftAttachments: [],
                noticeMessage: 'Agent 运行已启动。',
                sessionRecords: optimisticNewRecord
                    ? {
                        ...get().sessionRecords,
                        [response.sessionId]: optimisticNewRecord,
                    }
                    : get().sessionRecords,
                sessionRuns: {
                    ...get().sessionRuns,
                    [response.sessionId]: runStatus,
                },
                sessions: optimisticNewRecord
                    ? upsertSessionSummaryByHistoryOrder(
                        get().sessions,
                        buildSummaryFromRecord(optimisticNewRecord),
                        get().sessionHistoryOrder,
                    )
                    : get().sessions,
            });

            if (!activeSessionId && get().sessionHistoryOrder.length > 0) {
                const nextSessionHistoryOrder = prependSessionHistoryId(get().sessionHistoryOrder, response.sessionId);

                set({ sessionHistoryOrder: nextSessionHistoryOrder });
                void get().setSessionHistoryOrder(nextSessionHistoryOrder);
            }

            if (activeSessionId) {
                await Promise.all([
                    get().loadSessions(),
                    get().loadSession(response.sessionId),
                    get().refreshRuntimeStatus(),
                ]);
            } else {
                await get().refreshRuntimeStatus();
            }

            return true;
        } catch (error) {
            const message = normalizeError(error);

            if (activeSessionId) {
                const nextSessionRecords = { ...get().sessionRecords };
                const nextSessionRuns = { ...get().sessionRuns };

                if (previousRecord) {
                    nextSessionRecords[activeSessionId] = previousRecord;
                } else {
                    delete nextSessionRecords[activeSessionId];
                }

                if (previousRecord?.runStatus) {
                    nextSessionRuns[activeSessionId] = previousRecord.runStatus;
                } else {
                    delete nextSessionRuns[activeSessionId];
                }

                set({
                    draft,
                    draftAttachments,
                    errorMessage: message,
                    sessionRecords: nextSessionRecords,
                    sessionRuns: nextSessionRuns,
                    sessions: previousSummary
                        ? upsertSessionSummaryByHistoryOrder(
                            get().sessions.filter((session) => session.id !== activeSessionId),
                            previousSummary,
                            get().sessionHistoryOrder,
                        )
                        : get().sessions.filter((session) => session.id !== activeSessionId),
                });
            } else {
                set({ draft, draftAttachments, errorMessage: message });
            }

            return false;
        }
    },
    setActiveSessionId(sessionId) {
        set({ activeSessionId: sessionId });

        if (!sessionId) {
            void get().refreshRuntimeStatus();
            return;
        }

        if (!get().sessionRecords[sessionId]) {
            void get().loadSession(sessionId);
        }

        void get().refreshRuntimeStatus();
    },
    async setSessionHistoryOrder(historyOrder) {
        set({ sessionHistoryOrder: historyOrder });

        try {
            if (historyOrder.length === 0) {
                await apiClient.settings.delete(sessionHistoryOrderStorageKey);
            } else {
                await apiClient.settings.set(
                    sessionHistoryOrderStorageKey,
                    serializeSessionHistoryOrder(historyOrder),
                );
            }
        } catch (error) {
            set({ errorMessage: normalizeError(error) });
        }
    },
    setDraft(value) {
        set({ draft: value });
    },
    async stageAttachments() {
        set({ errorMessage: null, isStagingAttachments: true });

        try {
            const result = await apiClient.piAgent.stageAttachments();
            const currentAttachments = get().draftAttachments;
            const nextAttachments = [
                ...currentAttachments,
                ...result.attachments.filter((attachment) => !currentAttachments.some((current) => current.id === attachment.id)),
            ];
            const rejectedMessage = result.rejected.length > 0
                ? result.rejected.map((rejection) => `${rejection.name}: ${rejection.reason}`).join('\n')
                : null;

            set({
                draftAttachments: nextAttachments,
                errorMessage: rejectedMessage,
                isStagingAttachments: false,
            });

            return result.attachments.length > 0;
        } catch (error) {
            set({ errorMessage: normalizeError(error), isStagingAttachments: false });
            return false;
        }
    },
    startNewSession() {
        const attachmentIds = get().draftAttachments.map((attachment) => attachment.id);

        if (attachmentIds.length > 0) {
            void apiClient.piAgent.discardAttachments({ attachmentIds }).catch((error: unknown) => {
                set({ errorMessage: normalizeError(error) });
            });
        }

        set({
            activeSessionId: null,
            draft: '',
            draftAttachments: [],
            errorMessage: null,
            noticeMessage: '已切换到新的 Pi 会话。',
        });
    },
}));

export const resetPiAgentStore = () => {
    streamUnsubscribe?.();
    streamUnsubscribe = null;
    usePiAgentStore.setState({
        activeSessionId: null,
        draft: '',
        draftAttachments: [],
        errorMessage: null,
        isBootstrapped: false,
        isLoadingSession: false,
        isLoadingSessions: false,
        isStagingAttachments: false,
        noticeMessage: null,
        riskGateState: null,
        runtimeStatus: null,
        sessionRecords: {},
        sessionRuns: {},
        sessionHistoryOrder: [],
        sessions: [],
        skills: [],
    });
};
