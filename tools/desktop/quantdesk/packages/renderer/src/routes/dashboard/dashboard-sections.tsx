import { memo } from 'react';

import {
    Cell,
    Pie,
    PieChart,
    ResponsiveContainer,
    Tooltip,
} from 'recharts';

import type {
    RuntimeStatusResponse,
    StoredAsset,
    SyncStatus,
} from '@quantdesk/shared';

import { Badge } from '../../components/badge';
import { Button } from '../../components/button';
import { DeferredRender } from '../../components/deferred-render';
import { Input } from '../../components/input';
import { Select } from '../../components/select';
import { Textarea } from '../../components/textarea';
import {
    chartPalette,
    formatNumber,
    formatPercent,
    type PositionDraft,
    type PositionOverviewRow,
} from './dashboard-utils';

const DashboardMetricCardComponent = ({
    label,
    value,
    detail,
}: {
    label: string;
    value: string;
    detail: string;
}) => (
    <article className="min-w-0 overflow-hidden rounded-[16px] border border-[color:var(--color-border)] bg-[rgba(255,255,255,0.62)] p-3 shadow-[0_10px_26px_rgba(61,43,31,0.04)]">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">{label}</p>
        <p className="mt-2 truncate font-display text-2xl leading-7 text-[var(--color-foreground)]">{value}</p>
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--color-copy)]">{detail}</p>
    </article>
);

export const DashboardMetricCard = memo(DashboardMetricCardComponent);

DashboardMetricCard.displayName = 'DashboardMetricCard';

const PositionOverviewSectionComponent = ({
    onDeletePosition,
    onEditPosition,
    positionOverview,
}: {
    onDeletePosition: (positionId: string) => void;
    onEditPosition: (row: PositionOverviewRow) => void;
    positionOverview: PositionOverviewRow[];
}) => (
    <section className="rounded-[20px] border border-[color:var(--color-border)] bg-[rgba(255,252,248,0.78)] p-4 shadow-[0_12px_32px_rgba(61,43,31,0.05)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--color-muted)]">持仓概览</p>
                <h2 className="mt-2 font-display text-2xl text-[var(--color-foreground)]">当前组合分布与偏离提示</h2>
            </div>
            <Badge tone="accent">{positionOverview.length} 条持仓</Badge>
        </div>

        <div className="mt-5 grid gap-5 xl:grid-cols-[0.92fr_1.08fr]">
            <DeferredRender className="h-[320px]" fallbackLabel="进入可视区域后再渲染持仓饼图">
                {positionOverview.length === 0 ? (
                    <div className="flex h-full items-center justify-center rounded-[16px] border border-dashed border-[color:var(--color-border)] bg-[rgba(244,239,230,0.42)] px-5 text-sm text-[var(--color-copy)]">
                        还没有持仓。先在右侧录入一条持仓，或者导入 CSV。
                    </div>
                ) : (
                    <ResponsiveContainer height="100%" width="100%">
                        <PieChart>
                            <Pie
                                cx="50%"
                                cy="50%"
                                data={positionOverview.map((row) => ({ name: row.symbol, value: Number((row.currentWeight * 100).toFixed(2)) }))}
                                dataKey="value"
                                innerRadius={56}
                                outerRadius={102}
                                paddingAngle={3}
                            >
                                {positionOverview.map((row, index) => (
                                    <Cell fill={chartPalette[index % chartPalette.length]} key={row.positionId} />
                                ))}
                            </Pie>
                            <Tooltip formatter={(value: number | string) => `${Number(value).toFixed(1)}%`} />
                        </PieChart>
                    </ResponsiveContainer>
                )}
            </DeferredRender>

            <div className="space-y-3">
                {positionOverview.length === 0 ? (
                    <div className="rounded-[16px] border border-dashed border-[color:var(--color-border)] bg-[rgba(244,239,230,0.42)] p-4 text-sm leading-6 text-[var(--color-copy)]">
                        录入持仓后，这里会显示按缓存价格或成本价估算的持仓权重和目标偏离。
                    </div>
                ) : (
                    positionOverview.map((row) => (
                        <article className="rounded-[16px] border border-[color:var(--color-border)] bg-[rgba(244,239,230,0.42)] p-4" key={row.positionId}>
                            <div className="flex flex-wrap items-start justify-between gap-4">
                                <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <h3 className="font-display text-2xl text-[var(--color-foreground)]">{row.symbol}</h3>
                                        <Badge>{row.market}</Badge>
                                    </div>
                                    <p className="mt-2 text-sm leading-6 text-[var(--color-copy)]">{row.name}</p>
                                </div>
                                <div className="flex gap-2">
                                    <Button onClick={() => { onEditPosition(row); }} size="sm" tone="secondary">
                                        编辑
                                    </Button>
                                    <Button onClick={() => { onDeletePosition(row.positionId); }} size="sm" tone="danger">
                                        删除
                                    </Button>
                                </div>
                            </div>

                            <div className="mt-4 grid gap-3 text-sm text-[var(--color-copy)] md:grid-cols-4">
                                <p>当前权重 {formatPercent(row.currentWeight)}</p>
                                <p>目标权重 {row.targetWeight != null ? formatPercent(row.targetWeight) : '未纳入活跃方案'}</p>
                                <p>估算市值 {formatNumber(row.estimatedValue)}</p>
                                <p>{row.valuationLabel}</p>
                            </div>
                        </article>
                    ))
                )}
            </div>
        </div>
    </section>
);

export const PositionOverviewSection = memo(PositionOverviewSectionComponent);

PositionOverviewSection.displayName = 'PositionOverviewSection';

const PositionManagementSectionComponent = ({
    assets,
    draft,
    isImportingPositions,
    isSavingPosition,
    onAssetChange,
    onCostBasisChange,
    onCsvChange,
    onImport,
    onPortfolioNameChange,
    onReset,
    onSave,
    onSharesChange,
    positionCsvDraft,
    positionsCount,
}: {
    assets: StoredAsset[];
    draft: PositionDraft;
    isImportingPositions: boolean;
    isSavingPosition: boolean;
    onAssetChange: (assetId: string) => void;
    onCostBasisChange: (value: string) => void;
    onCsvChange: (value: string) => void;
    onImport: () => void;
    onPortfolioNameChange: (value: string) => void;
    onReset: () => void;
    onSave: () => void;
    onSharesChange: (value: string) => void;
    positionCsvDraft: string;
    positionsCount: number;
}) => (
    <section className="rounded-[20px] border border-[color:var(--color-border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.9),rgba(248,243,235,0.82))] p-4 shadow-[0_12px_32px_rgba(61,43,31,0.05)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--color-muted)]">持仓管理</p>
                <h2 className="mt-2 font-display text-2xl text-[var(--color-foreground)]">手动录入与 CSV 导入</h2>
            </div>
            <Badge tone="accent">Portfolio: {draft.portfolioName || 'default'}</Badge>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
            <label className="space-y-2 text-sm text-[var(--color-copy)]">
                <span className="text-xs uppercase tracking-[0.22em] text-[var(--color-muted)]">资产</span>
                <Select
                    className="h-11 w-full rounded-[18px] border border-[color:var(--color-border)] bg-white/88 px-4 text-sm text-[var(--color-foreground)]"
                    data-testid="dashboard-position-asset-select"
                    onChange={(event) => { onAssetChange((event.target as HTMLSelectElement | null)?.value ?? ''); }}
                    value={draft.assetId}
                >
                    <option value="">选择资产</option>
                    {assets.map((asset) => (
                        <option key={asset.id} value={asset.id}>
                            {asset.symbol} · {asset.name}
                        </option>
                    ))}
                </Select>
            </label>

            <label className="space-y-2 text-sm text-[var(--color-copy)]">
                <span className="text-xs uppercase tracking-[0.22em] text-[var(--color-muted)]">组合名称</span>
                <Input
                    className="h-11 w-full rounded-[18px] border border-[color:var(--color-border)] bg-white/88 px-4 text-sm text-[var(--color-foreground)]"
                    onChange={(event) => { onPortfolioNameChange(event.currentTarget.value); }}
                    value={draft.portfolioName}
                />
            </label>

            <label className="space-y-2 text-sm text-[var(--color-copy)]">
                <span className="text-xs uppercase tracking-[0.22em] text-[var(--color-muted)]">份额</span>
                <Input
                    className="h-11 w-full rounded-[18px] border border-[color:var(--color-border)] bg-white/88 px-4 text-sm text-[var(--color-foreground)]"
                    data-testid="dashboard-position-shares-input"
                    onChange={(event) => { onSharesChange(event.currentTarget.value); }}
                    placeholder="例如 120"
                    type="number"
                    value={draft.shares}
                />
            </label>

            <label className="space-y-2 text-sm text-[var(--color-copy)]">
                <span className="text-xs uppercase tracking-[0.22em] text-[var(--color-muted)]">成本价</span>
                <Input
                    className="h-11 w-full rounded-[18px] border border-[color:var(--color-border)] bg-white/88 px-4 text-sm text-[var(--color-foreground)]"
                    onChange={(event) => { onCostBasisChange(event.currentTarget.value); }}
                    placeholder="留空则按缓存价格或份额估值"
                    type="number"
                    value={draft.costBasis}
                />
            </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
            <Button data-testid="dashboard-manual-position-save" onClick={onSave} tone="primary">
                {isSavingPosition ? '保存中...' : draft.id ? '更新持仓' : '新增持仓'}
            </Button>
            <Button onClick={onReset} tone="ghost">清空表单</Button>
        </div>

        <div className="mt-4 rounded-[16px] border border-[color:var(--color-border)] bg-[rgba(255,255,255,0.62)] p-4">
            <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-muted)]">CSV 导入</p>
            <Textarea
                className="mt-3 min-h-[132px] w-full rounded-[14px] border border-[color:var(--color-border)] bg-white/88 px-4 py-3 text-sm leading-6 text-[var(--color-foreground)] outline-none"
                data-testid="dashboard-position-csv-input"
                onChange={(event) => { onCsvChange(event.currentTarget.value); }}
                placeholder={['symbol,market,shares,costBasis,currency,portfolioName', 'SPY,US,80,528.3,USD,default', '511010,BOND,120,108.6,CNY,default'].join('\n')}
                value={positionCsvDraft}
            />
            <div className="mt-4 flex flex-wrap gap-3">
                <Button data-testid="dashboard-import-positions-button" onClick={onImport} tone="secondary">
                    {isImportingPositions ? '导入中...' : '导入持仓 CSV'}
                </Button>
                <Badge>{positionsCount} 条已保存持仓</Badge>
            </div>
        </div>
    </section>
);

export const PositionManagementSection = memo(PositionManagementSectionComponent);

PositionManagementSection.displayName = 'PositionManagementSection';

const RuntimeStatusSectionComponent = ({
    heartbeat,
    nativeStatus,
    onRefresh,
    onRunHeartbeat,
    onRunNativeCheck,
    onRunRuntimeProbe,
    runtimeProbe,
    runtimeStatus,
    syncStatus,
}: {
    heartbeat: string | null;
    nativeStatus: string | null;
    onRefresh: () => void;
    onRunHeartbeat: () => void;
    onRunNativeCheck: () => void;
    onRunRuntimeProbe: () => void;
    runtimeProbe: string | null;
    runtimeStatus: RuntimeStatusResponse | null;
    syncStatus: SyncStatus | null;
}) => (
    <section className="rounded-[20px] border border-[color:var(--color-border)] bg-[rgba(255,252,248,0.78)] p-4 shadow-[0_12px_32px_rgba(61,43,31,0.05)]">
        <div className="flex items-start justify-between gap-4">
            <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--color-muted)]">运行状态</p>
                <h2 className="mt-2 font-display text-2xl text-[var(--color-foreground)]">IPC、原生模块与 Agent 运行检查</h2>
            </div>
            <Button onClick={onRefresh} tone="ghost">刷新状态</Button>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
            {[
                { label: '运行 IPC 心跳', onClick: onRunHeartbeat },
                { label: '检查原生模块', onClick: onRunNativeCheck },
                { label: '运行 Agent 探针', onClick: onRunRuntimeProbe },
            ].map((action) => (
                <Button key={action.label} onClick={action.onClick} tone="secondary">
                    {action.label}
                </Button>
            ))}
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
            <div className="rounded-[20px] border border-[color:var(--color-border)] bg-[rgba(244,239,230,0.44)] p-4 text-sm leading-6 text-[var(--color-copy)]">
                <p>{heartbeat ?? '等待心跳探针'}</p>
                <p className="mt-2">{nativeStatus ?? '等待原生模块探针'}</p>
                <p className="mt-2">{runtimeProbe ?? '等待 Agent 探针'}</p>
            </div>
            <div className="rounded-[20px] border border-[color:var(--color-border)] bg-[rgba(244,239,230,0.44)] p-4 text-sm leading-6 text-[var(--color-copy)]">
                <p>Sidecar: {runtimeStatus?.sidecarReady ? 'ready' : 'not ready'}</p>
                <p>PID: {runtimeStatus?.sidecarPid ?? 'n/a'}</p>
                <p>Port: {runtimeStatus?.sidecarPort ?? 'n/a'}</p>
                <p>价格快照: 由 quant-data 按需读取</p>
                <p>同步队列: {syncStatus?.running ? 'running' : 'idle'} / {syncStatus?.queuedTasks ?? 0}</p>
            </div>
        </div>
    </section>
);

export const RuntimeStatusSection = memo(RuntimeStatusSectionComponent);

RuntimeStatusSection.displayName = 'RuntimeStatusSection';