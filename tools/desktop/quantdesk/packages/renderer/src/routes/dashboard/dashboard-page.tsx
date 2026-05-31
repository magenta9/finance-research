import { useCallback, useEffect, useMemo, useState } from 'react';
import { InlineNotice } from '../../components/inline-notice';
import {
    ActivePlanPanel,
    DriftAlertsPanel,
    EmptyStateGuide,
    OfflineStateBanner,
    PiWorkspacePanel,
    SyncStatusBanner,
} from './dashboard-panels';
import { DashboardMetricCard, PositionManagementSection, PositionOverviewSection, RuntimeStatusSection } from './dashboard-sections';
import { derivePositionOverview, emptyPositionDraft, formatDashboardError, parsePositionsCsv, type DashboardState, type PositionOverviewRow } from './dashboard-utils';
import {
    deletePosition,
    importPositions,
    loadDashboardPageData,
    runHeartbeatCheck,
    runAgentRuntimeProbeCheck,
    runNativeBindingsCheck,
    savePosition,
    subscribeToDashboardSyncStatus,
} from './dashboard-client';

const cadenceLabelMap = {
    monthly: '月度调仓',
    none: '买入持有',
    quarterly: '季度调仓',
    weekly: '周度调仓',
} as const;

const strategyLabelMap = {
    erc: '等风险贡献',
    inverse_volatility: '反波动率加权',
    max_diversification: '最大分散化',
    max_diversification_research_v1: '最大分散化 MDP v3',
    ewmac_trend_following: 'EWMAC 趋势跟随',
    active_dual_momentum_gtaa: 'Active Dual Momentum',
} as const;

export const DashboardPage = () => {
    const [state, setState] = useState<DashboardState>({
        activePlan: null,
        assets: [],
        errorMessage: null,
        heartbeat: null,
        isImportingPositions: false,
        isLoading: true,
        isSavingPosition: false,
        latestPriceByAssetId: {},
        nativeStatus: null,
        noticeMessage: null,
        positionCsvDraft: '',
        positionDraft: emptyPositionDraft(),
        positions: [],
        runtimeProbe: null,
        runtimeStatus: null,
        syncStatus: null,
    });

    const loadDashboard = useCallback(async () => {
        setState((current) => ({ ...current, errorMessage: null, isLoading: true }));

        try {
            const {
                assets,
                latestPriceByAssetId,
                plans,
                positions,
                runtimeStatus,
                syncStatus,
            } = await loadDashboardPageData();

            const activePlan = plans.find((plan) => Boolean(plan.result)) ?? plans[0] ?? null;

            setState((current) => ({
                ...current,
                activePlan,
                assets,
                isLoading: false,
                latestPriceByAssetId,
                positions,
                runtimeStatus,
                syncStatus,
            }));
        } catch (error) {
            setState((current) => ({
                ...current,
                errorMessage: formatDashboardError(error),
                isLoading: false,
            }));
        }
    }, []);

    useEffect(() => {
        void loadDashboard();
    }, [loadDashboard]);

    useEffect(() => {
        const unsubscribe = subscribeToDashboardSyncStatus((syncStatus) => {
            setState((current) => ({ ...current, syncStatus }));
        });

        return unsubscribe;
    }, []);

    const positionOverview = useMemo(
        () =>
            derivePositionOverview({
                activePlan: state.activePlan,
                assets: state.assets,
                latestPriceByAssetId: state.latestPriceByAssetId,
                positions: state.positions,
            }),
        [state.activePlan, state.assets, state.latestPriceByAssetId, state.positions],
    );
    const positionsById = useMemo(
        () => new Map(state.positions.map((position) => [position.id, position])),
        [state.positions],
    );
    const assetsById = useMemo(
        () => new Map(state.assets.map((asset) => [asset.id, asset])),
        [state.assets],
    );
    const driftAlerts = useMemo(() => {
        if (!state.activePlan?.result) {
            return [];
        }

        const alerts: Array<PositionOverviewRow & { delta: number }> = [];

        for (const row of positionOverview) {
            const delta = row.currentWeight - (row.targetWeight ?? 0);

            if (Math.abs(delta) >= 0.05) {
                alerts.push({
                    ...row,
                    delta,
                });
            }
        }

        return alerts.sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta));
    }, [positionOverview, state.activePlan]);
    const hasPriceSnapshot = Object.keys(state.latestPriceByAssetId).length > 0;
    const updatePositionDraft = useCallback((patch: Partial<DashboardState['positionDraft']>) => {
        setState((current) => ({
            ...current,
            positionDraft: { ...current.positionDraft, ...patch },
        }));
    }, []);

    const handleSavePosition = useCallback(async () => {
        const shares = Number(state.positionDraft.shares);
        const costBasis = state.positionDraft.costBasis === '' ? null : Number(state.positionDraft.costBasis);

        if (!state.positionDraft.assetId) {
            setState((current) => ({ ...current, errorMessage: '请选择资产后再保存持仓。' }));
            return;
        }

        if (!Number.isFinite(shares) || shares <= 0) {
            setState((current) => ({ ...current, errorMessage: '持仓份额必须大于 0。' }));
            return;
        }

        if (costBasis != null && (!Number.isFinite(costBasis) || costBasis < 0)) {
            setState((current) => ({ ...current, errorMessage: '成本价必须大于或等于 0。' }));
            return;
        }

        setState((current) => ({ ...current, errorMessage: null, isSavingPosition: true }));

        try {
            await savePosition({
                assetId: state.positionDraft.assetId,
                costBasis,
                currency: state.positionDraft.currency,
                id: state.positionDraft.id ?? crypto.randomUUID(),
                portfolioName: state.positionDraft.portfolioName || 'default',
                shares,
            });

            setState((current) => ({
                ...current,
                isSavingPosition: false,
                noticeMessage: current.positionDraft.id ? '持仓已更新。' : '持仓已保存。',
                positionDraft: emptyPositionDraft(),
            }));
            await loadDashboard();
        } catch (error) {
            setState((current) => ({
                ...current,
                errorMessage: formatDashboardError(error),
                isSavingPosition: false,
            }));
        }
    }, [loadDashboard, state.positionDraft]);

    const handleImportPositions = useCallback(async () => {
        const parsed = parsePositionsCsv(state.positionCsvDraft, state.assets);

        if (parsed.error) {
            setState((current) => ({ ...current, errorMessage: parsed.error }));
            return;
        }

        setState((current) => ({ ...current, errorMessage: null, isImportingPositions: true }));

        try {
            const result = await importPositions(parsed.rows);

            setState((current) => ({
                ...current,
                isImportingPositions: false,
                noticeMessage: `持仓导入完成：成功 ${result.successCount}，失败 ${result.errorCount}。`,
                positionCsvDraft: result.errorCount === 0 ? '' : current.positionCsvDraft,
            }));
            await loadDashboard();
        } catch (error) {
            setState((current) => ({
                ...current,
                errorMessage: formatDashboardError(error),
                isImportingPositions: false,
            }));
        }
    }, [loadDashboard, state.assets, state.positionCsvDraft]);

    const handleDeletePosition = useCallback(async (positionId: string) => {
        try {
            await deletePosition(positionId);
            setState((current) => ({ ...current, noticeMessage: '持仓已删除。' }));
            await loadDashboard();
        } catch (error) {
            setState((current) => ({ ...current, errorMessage: formatDashboardError(error) }));
        }
    }, [loadDashboard]);

    const handleEditPosition = useCallback((row: PositionOverviewRow) => {
        const selectedPosition = positionsById.get(row.positionId);
        updatePositionDraft({
            assetId: row.assetId,
            costBasis: row.costBasis?.toString() ?? '',
            currency: selectedPosition?.currency ?? 'CNY',
            id: row.positionId,
            portfolioName: selectedPosition?.portfolioName ?? 'default',
            shares: row.shares.toString(),
        });
    }, [positionsById, updatePositionDraft]);

    const runHeartbeat = useCallback(async () => {
        try {
            const result = await runHeartbeatCheck();
            setState((current) => ({
                ...current,
                heartbeat: `心跳正常 · 版本 ${result.appVersion} · ${result.timestamp}`,
            }));
        } catch (error) {
            setState((current) => ({ ...current, errorMessage: formatDashboardError(error) }));
        }
    }, []);

    const runNativeCheck = useCallback(async () => {
        try {
            const result = await runNativeBindingsCheck();
            setState((current) => ({
                ...current,
                nativeStatus: `原生模块已通过 · ${result.driver} · SQLite ${result.sqliteVersion}`,
            }));
        } catch (error) {
            setState((current) => ({ ...current, errorMessage: formatDashboardError(error) }));
        }
    }, []);

    const runRuntimeProbe = useCallback(async () => {
        try {
            const result = await runAgentRuntimeProbeCheck();
            setState((current) => ({
                ...current,
                runtimeProbe:
                    result.exitCode === 0
                        ? 'Agent 探针成功'
                        : `Agent 探针失败 · 退出码 ${result.exitCode}`,
            }));
        } catch (error) {
            setState((current) => ({ ...current, errorMessage: formatDashboardError(error) }));
        }
    }, []);
    const handleClearMessages = useCallback(() => {
        setState((current) => ({ ...current, errorMessage: null, noticeMessage: null }));
    }, []);
    const handleAssetChange = useCallback((assetId: string) => {
        const asset = assetsById.get(assetId);
        updatePositionDraft({ assetId, currency: asset?.currency ?? state.positionDraft.currency });
    }, [assetsById, state.positionDraft.currency, updatePositionDraft]);
    const handleCostBasisChange = useCallback((value: string) => {
        updatePositionDraft({ costBasis: value });
    }, [updatePositionDraft]);
    const handleCsvChange = useCallback((value: string) => {
        setState((current) => ({ ...current, positionCsvDraft: value }));
    }, []);
    const handlePortfolioNameChange = useCallback((value: string) => {
        updatePositionDraft({ portfolioName: value });
    }, [updatePositionDraft]);
    const handleResetPositionDraft = useCallback(() => {
        setState((current) => ({ ...current, positionDraft: emptyPositionDraft() }));
    }, []);
    const handleSharesChange = useCallback((value: string) => {
        updatePositionDraft({ shares: value });
    }, [updatePositionDraft]);
    const handleDeletePositionRequest = useCallback((positionId: string) => {
        void handleDeletePosition(positionId);
    }, [handleDeletePosition]);
    const handleImportPositionsRequest = useCallback(() => {
        void handleImportPositions();
    }, [handleImportPositions]);
    const handleSavePositionRequest = useCallback(() => {
        void handleSavePosition();
    }, [handleSavePosition]);
    const handleRefreshDashboard = useCallback(() => {
        void loadDashboard();
    }, [loadDashboard]);
    const handleRunHeartbeatRequest = useCallback(() => {
        void runHeartbeat();
    }, [runHeartbeat]);
    const handleRunNativeCheckRequest = useCallback(() => {
        void runNativeCheck();
    }, [runNativeCheck]);
    const handleRunRuntimeProbeRequest = useCallback(() => {
        void runRuntimeProbe();
    }, [runRuntimeProbe]);

    return (
        <section className="space-y-4" data-testid="dashboard-page">
            {(state.noticeMessage || state.errorMessage) && (
                <InlineNotice
                    message={state.errorMessage ?? state.noticeMessage}
                    onDismiss={handleClearMessages}
                    tone={state.errorMessage ? 'danger' : 'default'}
                />
            )}

            {state.runtimeStatus && !state.runtimeStatus.sidecarReady && (
                <OfflineStateBanner hasPriceSnapshot={hasPriceSnapshot} runtimeStatus={state.runtimeStatus} />
            )}

            {state.syncStatus && (state.syncStatus.running || state.syncStatus.lastWarning) && (
                <SyncStatusBanner hasPriceSnapshot={hasPriceSnapshot} syncStatus={state.syncStatus} />
            )}

            <div className="grid gap-3 md:grid-cols-4">
                <DashboardMetricCard detail={state.activePlan ? `${strategyLabelMap[state.activePlan.strategy ?? state.activePlan.mode]} · ${state.activePlan.assets.length} 个标的 · ${cadenceLabelMap[state.activePlan.rebalanceCadence ?? 'none']}` : '尚未保存配置方案'} label="活跃方案" value={state.activePlan?.name ?? '未建立'} />
                <DashboardMetricCard detail="含手动录入与 CSV 导入持仓。" label="持仓数" value={String(state.positions.length)} />
                <DashboardMetricCard detail="偏离阈值按 5% 权重差计算。" label="风险警报" value={String(driftAlerts.length)} />
                <DashboardMetricCard detail="通过 quant-data 按需读取本地或 provider 行情。" label="价格快照" value={String(Object.keys(state.latestPriceByAssetId).length)} />
            </div>

            {!state.isLoading && state.assets.length === 0 && !state.activePlan && state.positions.length === 0 ? (
                <EmptyStateGuide />
            ) : (
                <div className="grid gap-4 2xl:grid-cols-[1.12fr_0.88fr]">
                    <div className="space-y-4">
                        <ActivePlanPanel activePlan={state.activePlan} cadenceLabelMap={cadenceLabelMap} />

                        <PositionOverviewSection
                            onDeletePosition={handleDeletePositionRequest}
                            onEditPosition={handleEditPosition}
                            positionOverview={positionOverview}
                        />
                    </div>

                    <div className="space-y-4">
                        <PositionManagementSection
                            assets={state.assets}
                            draft={state.positionDraft}
                            isImportingPositions={state.isImportingPositions}
                            isSavingPosition={state.isSavingPosition}
                            onAssetChange={handleAssetChange}
                            onCostBasisChange={handleCostBasisChange}
                            onCsvChange={handleCsvChange}
                            onImport={handleImportPositionsRequest}
                            onPortfolioNameChange={handlePortfolioNameChange}
                            onReset={handleResetPositionDraft}
                            onSave={handleSavePositionRequest}
                            onSharesChange={handleSharesChange}
                            positionCsvDraft={state.positionCsvDraft}
                            positionsCount={state.positions.length}
                        />

                        <PiWorkspacePanel />

                        <DriftAlertsPanel driftAlerts={driftAlerts} />

                        <RuntimeStatusSection
                            heartbeat={state.heartbeat}
                            nativeStatus={state.nativeStatus}
                            onRefresh={handleRefreshDashboard}
                            onRunHeartbeat={handleRunHeartbeatRequest}
                            onRunNativeCheck={handleRunNativeCheckRequest}
                            onRunRuntimeProbe={handleRunRuntimeProbeRequest}
                            runtimeProbe={state.runtimeProbe}
                            runtimeStatus={state.runtimeStatus}
                            syncStatus={state.syncStatus}
                        />
                    </div>
                </div>
            )}

            <div className="sr-only" data-testid="dashboard-position-count">{state.positions.length}</div>
            <div className="sr-only" data-testid="dashboard-drift-count">{driftAlerts.length}</div>
            <div className="sr-only" data-testid="dashboard-price-snapshot-count">{Object.keys(state.latestPriceByAssetId).length}</div>
            <div className="sr-only" data-testid="dashboard-plan-expected-return">{state.activePlan?.result?.portfolioMetrics.expectedReturn ?? 0}</div>
        </section>
    );
};
