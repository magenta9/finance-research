import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AgentWorkspaceShell } from '../components/agent/agent-workspace-shell';
import { ConversationHistoryPopover } from '../components/agent/conversation-history-popover';
import { Button } from '../components/button';
import { InlineNotice } from '../components/inline-notice';
import { PiConversationPane } from '../components/pi/pi-conversation-pane';
import { PiRuntimeDiagnosticsPanel } from '../components/pi/pi-runtime-diagnostics-panel';
import { usePiAgentStore } from '../stores/pi-agent-store';

const runStateLabel: Record<string, string> = {
    cancelled: '已取消',
    failed: '失败',
    idle: '空闲',
    running: '运行中',
};

const runtimeStateLabel: Record<string, string> = {
    degraded: '受限',
    error: '异常',
    idle: '空闲',
    ready: '已就绪',
    starting: '启动中',
};

const formatRuntimeState = (state?: string | null) => (
    state ? (runtimeStateLabel[state] ?? state) : '未加载'
);

const quantdeskResearchSkillPrompt = [
    '# QuantDesk Research',
    '',
    '你现在直接执行 QuantDesk Research 指令。不要查询 ~/.agents/skills，不要加载 deep-research，也不要说 quantdesk-research 不存在；下面就是完整投研指令。',
    '',
    '职责：作为 QuantDesk Pi Agent 的多角色投研员，用 QuantDesk finance tools 获取证据，并输出可审计结论。',
    '',
    '硬规则：',
    '- 必须优先调用 QuantDesk finance tools 获取证据。',
    '- 不要编造行情、价格、成交量、基本面、新闻、公告、宏观、资金流、情绪、组合持仓、风险指标或概率。',
    '- 不要把 display series 和 adjusted/calculation series 混用；工具说明口径不足时，把限制写进 dataGaps。',
    '- 工具不可用、覆盖不足、资产歧义或数据过旧时，降低 confidence，并把缺口写入 dataGaps。',
    '- evidence 和 dataProvenance 只能来自工具返回、QuantDesk 本地上下文或明确可追踪来源。',
    '- 不要输出交易执行指令；actionRecommendation 只表达研究动作上限。',
    '',
    '角色：按 allocation / trend / macro / fundamental / risk / factor / flow_sentiment / execution 中合适的角色分别给出结论。',
    '',
    '输出：先给一段人类可读摘要，然后输出一个 JSON object。JSON 至少包含 requestId、role、conclusion、confidence、direction、actionRecommendation、evidence、dataGaps、dataProvenance。',
    '',
    '研究问题：',
].join('\n');

const runStateTone = (state?: string): 'default' | 'accent' | 'muted' | 'danger' => {
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

export const PiAgentPage = () => {
    const activeSessionId = usePiAgentStore((state) => state.activeSessionId);
    const draft = usePiAgentStore((state) => state.draft);
    const draftAttachments = usePiAgentStore((state) => state.draftAttachments);
    const errorMessage = usePiAgentStore((state) => state.errorMessage);
    const isLoadingSession = usePiAgentStore((state) => state.isLoadingSession);
    const isLoadingSessions = usePiAgentStore((state) => state.isLoadingSessions);
    const isStagingAttachments = usePiAgentStore((state) => state.isStagingAttachments);
    const riskGateState = usePiAgentStore((state) => state.riskGateState);
    const runtimeStatus = usePiAgentStore((state) => state.runtimeStatus);
    const sessionRecords = usePiAgentStore((state) => state.sessionRecords);
    const sessionRuns = usePiAgentStore((state) => state.sessionRuns);
    const sessions = usePiAgentStore((state) => state.sessions);
    const skills = usePiAgentStore((state) => state.skills);
    const acknowledgeHighPrivilegeRisk = usePiAgentStore((state) => state.acknowledgeHighPrivilegeRisk);
    const cancelRun = usePiAgentStore((state) => state.cancelRun);
    const clearNotice = usePiAgentStore((state) => state.clearNotice);
    const deleteSession = usePiAgentStore((state) => state.deleteSession);
    const initialize = usePiAgentStore((state) => state.initialize);
    const openRuntimeDirectory = usePiAgentStore((state) => state.openRuntimeDirectory);
    const refreshRuntimeStatus = usePiAgentStore((state) => state.refreshRuntimeStatus);
    const removeDraftAttachment = usePiAgentStore((state) => state.removeDraftAttachment);
    const sendMessage = usePiAgentStore((state) => state.sendMessage);
    const setActiveSessionId = usePiAgentStore((state) => state.setActiveSessionId);
    const setDraft = usePiAgentStore((state) => state.setDraft);
    const stageAttachments = usePiAgentStore((state) => state.stageAttachments);
    const startNewSession = usePiAgentStore((state) => state.startNewSession);
    const conversationButtonRef = useRef<HTMLButtonElement | null>(null);
    const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
    const [isHistoryOverlayOpen, setIsHistoryOverlayOpen] = useState(false);

    useEffect(() => {
        void initialize();
    }, [initialize]);

    const activeSession = useMemo(
        () => (activeSessionId ? sessionRecords[activeSessionId] ?? null : null),
        [activeSessionId, sessionRecords],
    );
    const activeRun = useMemo(
        () => (activeSessionId ? sessionRuns[activeSessionId] ?? activeSession?.runStatus ?? null : null),
        [activeSession, activeSessionId, sessionRuns],
    );
    const currentModel = activeSession?.transcript.model?.modelId
        ?? runtimeStatus?.model.model
        ?? '未解析';
    const currentProvider = activeSession?.transcript.model?.provider
        ?? runtimeStatus?.model.provider
        ?? null;
    const lastToolName = activeSession?.toolSteps[activeSession.toolSteps.length - 1]?.toolName
        ?? activeRun?.currentTool
        ?? null;
    const isSending = activeRun?.state === 'running';
    const toolbarTitle = activeSession?.title || '新会话';
    const summaryStatus = riskGateState?.acknowledged ? '高权限已确认' : '发送前待确认';
    const threadItems = useMemo(
        () => sessions.map((session) => ({
            id: session.id,
            lastError: session.lastError,
            lastToolName: session.lastToolName,
            status: session.runState,
            title: session.title ?? null,
            titleStatus: session.titleStatus,
            updatedAt: session.updatedAt,
        })),
        [sessions],
    );
    const messageCount = activeSession?.transcript.messages.length ?? 0;
    const handleCancelRun = useCallback(() => {
        if (activeSessionId) {
            void cancelRun(activeSessionId);
        }
    }, [activeSessionId, cancelRun]);
    const handleSendMessage = useCallback(() => {
        void sendMessage();
    }, [sendMessage]);
    const handleUsePreset = useCallback((value: string) => {
        setDraft(value);
    }, [setDraft]);
    const handleDeleteSession = useCallback((sessionId: string) => {
        void deleteSession(sessionId);
    }, [deleteSession]);
    const handleToggleHistoryOverlay = useCallback(() => {
        setIsHistoryOverlayOpen((current) => !current);
    }, []);
    const handleCloseHistoryOverlay = useCallback(() => {
        setIsHistoryOverlayOpen(false);
    }, []);
    const workspaceActions = useMemo(
        () => [
            {
                label: '新建会话',
                onClick: startNewSession,
                testId: 'pi-agent-start-new-session',
                tone: 'primary' as const,
            },
            ...(isSending && activeSessionId
                ? [{
                    label: '取消运行',
                    onClick: handleCancelRun,
                    testId: 'pi-agent-cancel-run',
                    tone: 'danger' as const,
                }]
                : []),
            {
                label: '状态',
                onClick: () => {
                    setIsDiagnosticsOpen(true);
                },
                testId: 'pi-agent-open-diagnostics',
                tone: 'ghost' as const,
            },
        ],
        [activeSessionId, handleCancelRun, isSending, startNewSession],
    );
    const quickActions = useMemo(
        () => [
            { description: '通过 skill 召回多角色投研', key: 'pi-research-skill', label: '多角色投研', onClick: () => { handleUsePreset(`${quantdeskResearchSkillPrompt}恒生科技当前配置多少仓位合适？`); } },
            { description: '先让 Pi 给出局面判断', key: 'pi-market-open', label: '今天 A 股开盘行情', onClick: () => { handleUsePreset('今天 A 股开盘行情怎么样'); } },
            { description: '围绕科技板块深挖', key: 'pi-tech', label: '为什么科技板块涨幅居前', onClick: () => { handleUsePreset('分析一下为什么科技板块涨幅居前？'); } },
            { description: '结合命令与数据工具', key: 'pi-terminal', label: '本地拉数据并解释', onClick: () => { handleUsePreset('本地拉取最新市场数据并解释异常波动'); } },
            { description: '把想法落到组合动作', key: 'pi-plan', label: '生成今日调仓建议', onClick: () => { handleUsePreset('生成今日调仓建议'); } },
        ],
        [handleUsePreset],
    );
    const sidebarSections = useMemo(() => [
        {
            content: (
                <div className="space-y-1.5 text-xs leading-5 text-[var(--color-copy)]">
                    {[
                        ['会话主题', toolbarTitle],
                        ['权限', summaryStatus],
                        ['最近工具', lastToolName ?? '暂无'],
                        ['目录', activeSession?.cwd ?? '未提供'],
                    ].map(([label, value]) => (
                        <div className="flex items-start justify-between gap-3" key={label}>
                            <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-muted)]">{label}</span>
                            <span className="min-w-0 max-w-[210px] truncate text-right font-medium text-[var(--color-foreground)]">{value as React.ReactNode}</span>
                        </div>
                    ))}
                </div>
            ),
            eyebrow: '当前',
            icon: 'context' as const,
            title: '当前上下文',
        },
        {
            content: (
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs leading-5">
                    {[
                        ['消息数', String(messageCount)],
                        ['会话数', String(sessions.length)],
                        ['运行', runStateLabel[activeRun?.state ?? 'idle']],
                        ['更新', activeRun?.updatedAt?.slice(11, 19) ?? activeSession?.updatedAt?.slice(11, 19) ?? '未知'],
                    ].map(([label, value]) => (
                        <div className="flex items-center justify-between gap-2 rounded-[10px] bg-[rgba(248,243,235,0.44)] px-2 py-1" key={label}>
                            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-muted)]">{label}</span>
                            <span className="font-semibold text-[var(--color-foreground)]">{value}</span>
                        </div>
                    ))}
                </div>
            ),
            eyebrow: '统计',
            icon: 'stats' as const,
            title: '会话统计',
        },
        {
            content: (
                <div className="space-y-1.5">
                    {([] as Array<[string, string, () => void]>).concat([
                        ['投研 skill', 'quantdesk-research', () => { handleUsePreset(quantdeskResearchSkillPrompt); }],
                        ['/risk', '风险分析工具', () => { handleUsePreset('/risk'); }],
                        ['/macro', '宏观分析工具', () => { handleUsePreset('/macro'); }],
                        ['/rebalance', '再平衡指令', () => { handleUsePreset('/rebalance'); }],
                        ['分析 SPY', '填入 SPY 分析', () => { handleUsePreset('分析 SPY'); }],
                        ['生成配置', '生成配置草案', () => { handleUsePreset('生成配置'); }],
                        ['工作目录', '打开 runtime workspace', () => { void openRuntimeDirectory('workspaceDir'); }],
                        ['会话目录', '打开 session 记录', () => { void openRuntimeDirectory('sessionDir'); }],
                    ]).map(([label, description, onClick]) => (
                        <Button
                            className="h-8 w-full justify-between rounded-[10px] border-[rgba(156,98,55,0.1)] bg-transparent px-2 text-left shadow-none hover:border-[rgba(156,98,55,0.22)] hover:bg-[rgba(248,243,235,0.62)]"
                            key={label}
                            onClick={onClick}
                            size="sm"
                            tone="ghost"
                            type="button"
                        >
                            <span className="flex min-w-0 items-center gap-2">
                                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[7px] border border-[rgba(156,98,55,0.12)] bg-[rgba(248,243,235,0.62)] font-mono text-[9px] font-semibold uppercase tracking-[0] text-[var(--color-highlight)]">{label.replace('/', '').slice(0, 2)}</span>
                                <span className="min-w-0">
                                    <span className="block truncate text-xs font-semibold leading-4 text-[var(--color-foreground)]">{label}</span>
                                    <span className="block truncate text-[10px] leading-3 text-[var(--color-muted)]">{description}</span>
                                </span>
                            </span>
                        </Button>
                    ))}
                </div>
            ),
            eyebrow: '工具',
            icon: 'tools' as const,
            title: '工具箱',
        },
    ], [
        activeRun?.state,
        activeRun?.updatedAt,
        activeSession?.cwd,
        activeSession?.updatedAt,
        handleUsePreset,
        lastToolName,
        messageCount,
        openRuntimeDirectory,
        sessions.length,
        summaryStatus,
        toolbarTitle,
    ]);
    const historyOverlayControlsId = 'pi-history-overlay';

    return (
        <section className="flex h-full min-h-0 flex-col gap-3 overflow-hidden p-2" data-testid="pi-agent-page">
            {errorMessage && (
                <InlineNotice message={errorMessage} onDismiss={clearNotice} tone="danger" />
            )}

            <AgentWorkspaceShell
                actions={workspaceActions}
                conversationButtonLabel={`会话：${toolbarTitle}`}
                conversationButtonRef={conversationButtonRef}
                historyOverlayControlsId={historyOverlayControlsId}
                historyOverlayOpen={isHistoryOverlayOpen}
                conversationMeta={`${sessions.length} 条会话`}
                onToggleHistoryOverlay={handleToggleHistoryOverlay}
                rightSidebarSections={sidebarSections}
                runtimeLabel={formatRuntimeState(runtimeStatus?.state)}
                statusItems={[
                    { label: runStateLabel[activeRun?.state ?? 'idle'], tone: runStateTone(activeRun?.state) },
                    { label: summaryStatus, tone: riskGateState?.acknowledged ? 'accent' : 'default' },
                ]}
            >
                <PiConversationPane
                    attachments={draftAttachments}
                    draft={draft}
                    isLoadingSession={isLoadingSession}
                    isSending={isSending}
                    isStagingAttachments={isStagingAttachments}
                    modelLabel={currentModel}
                    onAcknowledgeRisk={acknowledgeHighPrivilegeRisk}
                    onAttachFiles={stageAttachments}
                    onCancel={handleCancelRun}
                    onDraftChange={setDraft}
                    onRemoveAttachment={(attachmentId) => { void removeDraftAttachment(attachmentId); }}
                    onSend={handleSendMessage}
                    providerLabel={currentProvider}
                    quickActions={quickActions}
                    riskGateState={riskGateState}
                    runStatus={activeRun}
                    session={activeSession}
                    skills={skills}
                />
            </AgentWorkspaceShell>

            <ConversationHistoryPopover
                activeConversationId={activeSessionId}
                allowDelete
                anchorRef={conversationButtonRef}
                conversations={threadItems}
                id={historyOverlayControlsId}
                isLoading={isLoadingSessions}
                onClose={handleCloseHistoryOverlay}
                onCreateConversation={startNewSession}
                onDeleteConversation={handleDeleteSession}
                onSelectConversation={setActiveSessionId}
                open={isHistoryOverlayOpen}
            />

            <PiRuntimeDiagnosticsPanel
                onAcknowledgeRisk={acknowledgeHighPrivilegeRisk}
                onClose={() => {
                    setIsDiagnosticsOpen(false);
                }}
                onOpenDirectory={(target) => {
                    void openRuntimeDirectory(target);
                }}
                onRefresh={() => {
                    void refreshRuntimeStatus();
                }}
                open={isDiagnosticsOpen}
                riskGateState={riskGateState}
                runtimeStatus={runtimeStatus}
            />

            <div className="sr-only" data-testid="pi-agent-session-count">{sessions.length}</div>
            <div className="sr-only" data-testid="pi-agent-message-count">{activeSession?.projection.timeline.length ?? 0}</div>
            <div className="sr-only" data-testid="pi-agent-last-tool">{lastToolName ?? ''}</div>
            <div className="sr-only" data-testid="pi-agent-run-state">{activeRun?.state ?? ''}</div>
            <div className="sr-only" data-testid="pi-agent-runtime-state">{runtimeStatus?.state ?? ''}</div>
            <div className="sr-only" data-testid="pi-agent-risk-acknowledged">{riskGateState?.acknowledged ? '1' : '0'}</div>
        </section>
    );
};
