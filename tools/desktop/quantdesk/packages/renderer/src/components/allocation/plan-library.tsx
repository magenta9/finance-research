import { memo } from 'react';

import type { AllocationPlanRecord } from '@quantdesk/shared';

import { Badge } from '../badge';
import { Button } from '../button';
import { Input } from '../input';

const modeLabelMap = {
    erc: '等风险贡献',
    inverse_volatility: '反波动率加权',
    max_diversification: '最大分散化',
} as const;

const strategyLabelMap = {
    ...modeLabelMap,
    ewmac_trend_following: 'EWMAC 趋势跟随',
} as const;

const cadenceLabelMap = {
    monthly: '月度',
    none: '持有',
    quarterly: '季度',
} as const;

const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`;

interface PlanLibraryProps {
    activePlanId: string | null;
    canSaveCurrent: boolean;
    exportFilename: string | null;
    exportPayload: string | null;
    isLoading: boolean;
    isSaving: boolean;
    onDeletePlan: (plan: AllocationPlanRecord) => void;
    onExportPlan: (plan: AllocationPlanRecord) => void;
    onLoadPlan: (plan: AllocationPlanRecord) => void;
    onPlanNameChange: (value: string) => void;
    onSaveCurrent: () => void;
    planNameDraft: string;
    plans: AllocationPlanRecord[];
}

const PlanLibraryComponent = ({
    activePlanId,
    canSaveCurrent,
    exportFilename,
    exportPayload,
    isLoading,
    isSaving,
    onDeletePlan,
    onExportPlan,
    onLoadPlan,
    onPlanNameChange,
    onSaveCurrent,
    planNameDraft,
    plans,
}: PlanLibraryProps) => (
    <section className="rounded-[20px] border border-[color:var(--color-border)] bg-[rgba(255,252,248,0.78)] p-4 shadow-[0_12px_32px_rgba(61,43,31,0.05)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--color-muted)]">方案管理</p>
                <h2 className="mt-2 font-display text-2xl text-[var(--color-foreground)]">保存、加载与导出配置方案</h2>
            </div>
            <Badge tone="accent">历史方案 {plans.length}</Badge>
        </div>

        <div className="mt-4 rounded-[16px] border border-[color:var(--color-border)] bg-[rgba(255,255,255,0.62)] p-4">
            <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-muted)]">保存当前结果</p>
            <div className="mt-3 flex flex-col gap-3 xl:flex-row">
                <Input
                    className="h-10 flex-1 rounded-[12px] border border-[color:var(--color-border)] bg-white/85 px-3 text-sm text-[var(--color-foreground)] outline-none placeholder:text-[var(--color-muted)]"
                    onChange={(event) => {
                        onPlanNameChange(event.currentTarget.value);
                    }}
                    placeholder="输入方案名称，例如 全天候试算 v1"
                    value={planNameDraft}
                    data-testid="allocation-plan-name-input"
                />
                <Button
                    disabled={!canSaveCurrent || isSaving}
                    onClick={onSaveCurrent}
                    tone="primary"
                    data-testid="allocation-save-plan-button"
                >
                    {isSaving ? '保存中...' : '保存方案'}
                </Button>
            </div>
        </div>

        <div className="mt-4 space-y-3" data-testid="allocation-plan-library">
            {isLoading ? (
                <div className="rounded-[16px] border border-dashed border-[color:var(--color-border)] bg-[rgba(244,239,230,0.44)] p-4 text-sm text-[var(--color-copy)]">
                    正在读取历史方案...
                </div>
            ) : plans.length === 0 ? (
                <div className="rounded-[16px] border border-dashed border-[color:var(--color-border)] bg-[rgba(244,239,230,0.44)] p-4 text-sm text-[var(--color-copy)]">
                    还没有保存过方案。先运行一次配置，再把结果归档到历史列表。
                </div>
            ) : (
                plans.map((plan) => {
                    const isActive = plan.id === activePlanId;

                    return (
                        <article
                            className={[
                                'rounded-[16px] border p-4 transition',
                                isActive
                                    ? 'border-[var(--color-highlight-soft)] bg-[rgba(156,98,55,0.08)]'
                                    : 'border-[color:var(--color-border)] bg-[rgba(255,255,255,0.78)]',
                            ].join(' ')}
                            key={plan.id}
                            data-testid={`allocation-plan-card-${plan.id}`}
                        >
                            <div className="flex flex-wrap items-start justify-between gap-4">
                                <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <h3 className="font-display text-2xl text-[var(--color-foreground)]">{plan.name}</h3>
                                        {isActive && <Badge tone="accent">当前加载</Badge>}
                                        <Badge>{cadenceLabelMap[plan.rebalanceCadence ?? 'none']}</Badge>
                                    </div>
                                    <p className="mt-2 text-sm leading-6 text-[var(--color-copy)]">
                                        {strategyLabelMap[plan.strategy ?? plan.mode]} · {plan.assets.length} 个标的 · 保存于 {plan.updatedAt.slice(0, 16).replace('T', ' ')}
                                    </p>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <Button
                                        onClick={() => {
                                            onLoadPlan(plan);
                                        }}
                                        size="sm"
                                        tone="secondary"
                                        data-testid={`allocation-load-plan-${plan.id}`}
                                    >
                                        加载
                                    </Button>
                                    <Button
                                        onClick={() => {
                                            onExportPlan(plan);
                                        }}
                                        size="sm"
                                        tone="ghost"
                                        data-testid={`allocation-export-plan-${plan.id}`}
                                    >
                                        导出 JSON
                                    </Button>
                                    <Button
                                        onClick={() => {
                                            onDeletePlan(plan);
                                        }}
                                        size="sm"
                                        tone="danger"
                                        data-testid={`allocation-delete-plan-${plan.id}`}
                                    >
                                        删除
                                    </Button>
                                </div>
                            </div>

                            {plan.result && (
                                <div className="mt-4 grid gap-3 md:grid-cols-3">
                                    <div className="rounded-[12px] border border-[color:var(--color-border)] bg-[rgba(244,239,230,0.42)] p-3 text-sm text-[var(--color-copy)]">
                                        收益 {formatPercent(plan.result.portfolioMetrics.expectedReturn)}
                                    </div>
                                    <div className="rounded-[12px] border border-[color:var(--color-border)] bg-[rgba(244,239,230,0.42)] p-3 text-sm text-[var(--color-copy)]">
                                        波动 {formatPercent(plan.result.portfolioMetrics.volatility)}
                                    </div>
                                    <div className="rounded-[12px] border border-[color:var(--color-border)] bg-[rgba(244,239,230,0.42)] p-3 text-sm text-[var(--color-copy)]">
                                        夏普 {plan.result.portfolioMetrics.sharpeRatio.toFixed(2)}
                                    </div>
                                </div>
                            )}
                        </article>
                    );
                })
            )}
        </div>

        <div className="sr-only" data-testid="allocation-active-plan-name">
            {plans.find((plan) => plan.id === activePlanId)?.name ?? ''}
        </div>
        <div className="sr-only" data-testid="allocation-export-filename">{exportFilename ?? ''}</div>
        <div className="sr-only" data-testid="allocation-export-payload">{exportPayload ?? ''}</div>
        <div className="sr-only" data-testid="allocation-plan-count">{plans.length}</div>
        <div className="sr-only" data-testid="allocation-plan-names">{plans.map((plan) => plan.name).join(',')}</div>
    </section>
);

export const PlanLibrary = memo(PlanLibraryComponent);

PlanLibrary.displayName = 'PlanLibrary';