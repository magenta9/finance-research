import { Link } from 'react-router-dom';

import type { AllocationPlanRecord, CacheSummary, RuntimeStatusResponse, SyncStatus } from '@quantdesk/shared';

import { Badge } from '../../components/badge';
import { formatPercent, type PositionOverviewRow } from './dashboard-utils';

export const OfflineStateBanner = ({
    hasCacheFallback,
    runtimeStatus,
}: {
    hasCacheFallback: boolean;
    runtimeStatus: RuntimeStatusResponse;
}) => (
    <div className="rounded-[16px] border border-[color:var(--color-highlight-soft)] bg-[rgba(156,98,55,0.08)] p-4 text-sm leading-6 text-[var(--color-copy)]" data-testid="dashboard-offline-state">
        <p className="text-xs uppercase tracking-[0.24em] text-[var(--color-highlight)]">离线 / Sidecar 降级</p>
        <p className="mt-2">
            当前 sidecar 未就绪。{hasCacheFallback ? '已自动回退到本地缓存，可继续浏览历史方案和本地持仓。' : '当前没有价格缓存，涉及同步行情的功能需要先恢复 sidecar 或改用 CSV 导入。'}
        </p>
        {runtimeStatus.lastError ? <p className="mt-2 text-[#7d2c22]">最近错误：{runtimeStatus.lastError}</p> : null}
    </div>
);

export const SyncStatusBanner = ({
    hasCacheFallback,
    cacheSummary,
    syncStatus,
}: {
    hasCacheFallback: boolean;
    cacheSummary: CacheSummary | null;
    syncStatus: SyncStatus;
}) => (
    <div className="rounded-[16px] border border-[color:var(--color-border)] bg-[rgba(244,239,230,0.52)] p-4 text-sm leading-6 text-[var(--color-copy)]" data-testid="dashboard-sync-status-banner">
        <p className="text-xs uppercase tracking-[0.24em] text-[var(--color-highlight)]">后台同步</p>
        <p className="mt-2">
            {syncStatus.running
                ? `正在补齐本地行情数据，队列中还有 ${syncStatus.queuedTasks} 个任务。`
                : '最近一次后台同步产生了 warning。'}
        </p>
        {(hasCacheFallback || cacheSummary?.fxRateRowCount) && syncStatus.running ? (
            <p className="mt-2 text-[var(--color-muted)]">当前估值可能基于旧缓存，数据不一定是最新。</p>
        ) : null}
        {syncStatus.lastWarning ? <p className="mt-2 text-[#7d2c22]">最近 warning：{syncStatus.lastWarning}</p> : null}
    </div>
);

export const EmptyStateGuide = () => (
    <section className="rounded-[20px] border border-dashed border-[color:var(--color-border)] bg-[rgba(255,252,248,0.78)] p-5 text-[var(--color-copy)] shadow-[0_12px_32px_rgba(61,43,31,0.05)]">
        <p className="text-xs uppercase tracking-[0.28em] text-[var(--color-muted)]">空状态引导</p>
        <h2 className="mt-2 font-display text-2xl text-[var(--color-foreground)]">从第一条工作链路开始</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
            <Link className="rounded-[14px] border border-[color:var(--color-border)] bg-[rgba(244,239,230,0.46)] p-4 transition hover:border-[var(--color-highlight-soft)]" to="/assets">
                <p className="text-sm uppercase tracking-[0.24em] text-[var(--color-highlight)]">01 添加资产</p>
                <p className="mt-2 text-sm leading-6">先去资产池添加可投资标的，或者直接导入 CSV。</p>
            </Link>
            <Link className="rounded-[14px] border border-[color:var(--color-border)] bg-[rgba(244,239,230,0.46)] p-4 transition hover:border-[var(--color-highlight-soft)]" to="/allocation">
                <p className="text-sm uppercase tracking-[0.24em] text-[var(--color-highlight)]">02 生成方案</p>
                <p className="mt-2 text-sm leading-6">运行一次风险平价或最大夏普，把结果保存到方案库。</p>
            </Link>
            <Link className="rounded-[14px] border border-[color:var(--color-border)] bg-[rgba(244,239,230,0.46)] p-4 transition hover:border-[var(--color-highlight-soft)]" to="/pi-agent">
                <p className="text-sm uppercase tracking-[0.24em] text-[var(--color-highlight)]">03 打开 Pi</p>
                <p className="mt-2 text-sm leading-6">Pi Agent 已替代旧本地智能体工作流，可直接在本地会话里解释结果并执行工具。</p>
            </Link>
        </div>
    </section>
);

export const ActivePlanPanel = ({
    activePlan,
    cadenceLabelMap,
}: {
    activePlan: AllocationPlanRecord | null;
    cadenceLabelMap: Record<string, string>;
}) => (
    <section className="rounded-[20px] border border-[color:var(--color-border)] bg-[rgba(255,252,248,0.78)] p-4 shadow-[0_12px_32px_rgba(61,43,31,0.05)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--color-muted)]">活跃方案</p>
                <h2 className="mt-2 font-display text-2xl text-[var(--color-foreground)]">最近一次已保存配置</h2>
            </div>
            {activePlan && (
                <div className="flex flex-wrap gap-2">
                    <Badge tone="accent">{activePlan.mode}</Badge>
                    <Badge>{cadenceLabelMap[activePlan.rebalanceCadence ?? 'none']}</Badge>
                </div>
            )}
        </div>

        {!activePlan?.result ? (
            <div className="mt-4 rounded-[16px] border border-dashed border-[color:var(--color-border)] bg-[rgba(244,239,230,0.42)] p-4 text-sm leading-6 text-[var(--color-copy)]">
                还没有可展示的已保存方案。去配置方案页跑一轮并保存后，这里会显示关键指标与风险摘要。
            </div>
        ) : (
            <div className="mt-4 space-y-4">
                <div className="grid gap-3 md:grid-cols-4">
                    <div className="rounded-[20px] border border-[color:var(--color-border)] bg-[rgba(244,239,230,0.42)] p-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-[var(--color-muted)]">预期收益</p>
                        <p className="mt-2 font-display text-2xl text-[var(--color-foreground)]">{formatPercent(activePlan.result.portfolioMetrics.expectedReturn)}</p>
                    </div>
                    <div className="rounded-[20px] border border-[color:var(--color-border)] bg-[rgba(244,239,230,0.42)] p-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-[var(--color-muted)]">波动率</p>
                        <p className="mt-2 font-display text-2xl text-[var(--color-foreground)]">{formatPercent(activePlan.result.portfolioMetrics.volatility)}</p>
                    </div>
                    <div className="rounded-[20px] border border-[color:var(--color-border)] bg-[rgba(244,239,230,0.42)] p-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-[var(--color-muted)]">夏普比率</p>
                        <p className="mt-2 font-display text-2xl text-[var(--color-foreground)]">{activePlan.result.portfolioMetrics.sharpeRatio.toFixed(2)}</p>
                    </div>
                    <div className="rounded-[20px] border border-[color:var(--color-border)] bg-[rgba(244,239,230,0.42)] p-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-[var(--color-muted)]">最大回撤</p>
                        <p className="mt-2 font-display text-2xl text-[var(--color-foreground)]">{formatPercent(activePlan.result.portfolioMetrics.maxDrawdown)}</p>
                    </div>
                </div>

                <div className="rounded-[16px] border border-[color:var(--color-border)] bg-[rgba(255,255,255,0.58)] p-4 text-sm leading-6 text-[var(--color-copy)]">
                    <p className="font-display text-2xl text-[var(--color-foreground)]" data-testid="dashboard-active-plan-name">{activePlan.name}</p>
                    <p className="mt-2">基准货币 {activePlan.baseCurrency}，共 {activePlan.assets.length} 个标的，{cadenceLabelMap[activePlan.rebalanceCadence ?? 'none']}，保存于 {activePlan.updatedAt.slice(0, 19).replace('T', ' ')}。</p>
                    <p className="mt-2">当前结果来自 {activePlan.result.diagnostics.optimizer.toUpperCase()} 优化器，对齐 {activePlan.result.diagnostics.alignedDates} 个交易日。</p>
                </div>
            </div>
        )}
    </section>
);

export const PiWorkspacePanel = () => (
    <section className="rounded-[20px] border border-[color:var(--color-border)] bg-[rgba(255,252,248,0.78)] p-4 shadow-[0_12px_32px_rgba(61,43,31,0.05)]">
        <div className="flex items-start justify-between gap-4">
            <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--color-muted)]">Pi Workspace</p>
                <h2 className="mt-2 font-display text-2xl text-[var(--color-foreground)]">Pi Agent 工作台</h2>
            </div>
            <Badge tone="accent">/pi-agent</Badge>
        </div>
        <div className="mt-4 rounded-[16px] border border-[color:var(--color-border)] bg-[rgba(244,239,230,0.44)] p-4 text-sm leading-6 text-[var(--color-copy)]">
            <p data-testid="dashboard-pi-workspace-summary">Pi Agent 已完全替代旧本地 agent 工作台。去 Pi 页面发起本地会话、调用 finance tools，并保留运行目录与 session 记录。</p>
            <Link className="mt-4 inline-flex rounded-[12px] border border-[color:var(--color-border)] bg-white/80 px-4 py-2 font-medium text-[var(--color-foreground)] transition hover:border-[var(--color-highlight-soft)]" to="/pi-agent">
                打开 Pi Agent
            </Link>
        </div>
    </section>
);

type DriftAlertRow = PositionOverviewRow & { delta: number };

export const DriftAlertsPanel = ({
    driftAlerts,
}: {
    driftAlerts: DriftAlertRow[];
}) => (
    <section className="rounded-[20px] border border-[color:var(--color-border)] bg-[rgba(255,252,248,0.78)] p-4 shadow-[0_12px_32px_rgba(61,43,31,0.05)]">
        <div className="flex items-start justify-between gap-4">
            <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--color-muted)]">风险警报</p>
                <h2 className="mt-2 font-display text-2xl text-[var(--color-foreground)]">持仓与目标方案偏离</h2>
            </div>
            <Badge tone={driftAlerts.length > 0 ? 'accent' : 'muted'}>{driftAlerts.length} 条告警</Badge>
        </div>

        {driftAlerts.length === 0 ? (
            <div className="mt-4 rounded-[16px] border border-dashed border-[color:var(--color-border)] bg-[rgba(244,239,230,0.44)] p-4 text-sm leading-6 text-[var(--color-copy)]">
                当前没有超过 5% 的显著偏离，或者尚未形成可比较的目标方案与持仓数据。
            </div>
        ) : (
            <div className="mt-4 space-y-3">
                {driftAlerts.slice(0, 5).map((alert) => (
                    <article className="rounded-[20px] border border-[rgba(181,75,60,0.18)] bg-[rgba(181,75,60,0.06)] p-4 text-sm leading-6 text-[#7d2c22]" key={alert.positionId}>
                        <p className="font-medium">{alert.symbol}</p>
                        <p>
                            当前权重 {formatPercent(alert.currentWeight)}，目标权重 {formatPercent(alert.targetWeight ?? 0)}，偏离 {formatPercent(Math.abs(alert.delta))}。
                        </p>
                    </article>
                ))}
            </div>
        )}
    </section>
);