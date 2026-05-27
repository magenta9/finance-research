import { useState, type ComponentProps } from 'react';

import type { AllocationConstraints, AllocationStrategy, AllocationStrategyMix, RebalanceCadence, StoredAsset } from '@quantdesk/shared';

import { AllocationVisualizationPanel } from '../../components/allocation/visualization-panel';
import { Badge } from '../../components/badge';
import { Button } from '../../components/button';
import { Checkbox } from '../../components/checkbox';
import { Input } from '../../components/input';
import { SearchInput } from '../../components/search-input';
import { Select } from '../../components/select';

const dateWindowPresets = [
    { days: 365, label: '1Y' },
    { days: 730, label: '2Y' },
    { days: 1095, label: '3Y' },
    { days: 1825, label: '5Y' },
] as const;

const cadenceLabelMap: Record<RebalanceCadence, string> = {
    monthly: '月度调仓',
    none: '无调仓',
    quarterly: '季度调仓',
    weekly: '周度调仓',
};

const strategyOptions: Array<{ description: string; label: string; value: AllocationStrategy }> = [
    { description: '追求风险贡献更均衡', label: '等风险贡献', value: 'erc' },
    { description: '低波动资产权重更高', label: '反波动率加权', value: 'inverse_volatility' },
    { description: '最大化组合分散化效率', label: '最大分散化', value: 'max_diversification' },
    { description: '用 EWMAC 长短线规则生成趋势暴露', label: 'EWMAC 趋势跟随', value: 'ewmac_trend_following' },
    { description: '周度双动量 GTAA，支持 ETF 与期货混合池。', label: 'Active Dual Momentum', value: 'active_dual_momentum_gtaa' },
];

const strategyLabelMap: Record<AllocationStrategy, string> = Object.fromEntries(
    strategyOptions.map((option) => [option.value, option.label]),
) as Record<AllocationStrategy, string>;

const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`;

const formatAssetLabel = (asset: Pick<StoredAsset, 'name' | 'symbol'>) => `${asset.symbol}（${asset.name}）`;

const defaultEwmacRuleControls = [
    { enabled: true, fast: 2, scalar: 10.6, slow: 8, weight: 1 },
    { enabled: true, fast: 4, scalar: 7.5, slow: 16, weight: 1 },
    { enabled: true, fast: 8, scalar: 5.3, slow: 32, weight: 1 },
    { enabled: true, fast: 16, scalar: 3.75, slow: 64, weight: 1 },
    { enabled: true, fast: 32, scalar: 2.65, slow: 128, weight: 1 },
    { enabled: true, fast: 64, scalar: 1.87, slow: 256, weight: 1 },
] as const;

const resolveTrendFollowingConfig = (strategyMix: AllocationStrategyMix) => {
    const configuredRules = strategyMix.trendFollowing?.rules ?? [];
    const configuredRulesByFast = new Map(configuredRules.map((rule) => [rule.fast, rule]));

    return {
        allowShort: strategyMix.trendFollowing?.allowShort ?? true,
        rules: defaultEwmacRuleControls.map((rule) => {
            const configuredRule = configuredRulesByFast.get(rule.fast);

            return {
                ...rule,
                enabled: configuredRule?.enabled ?? rule.enabled,
            };
        }),
    };
};

const getPresetStartDate = (days: number) => {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().slice(0, 10);
};

const formatResultDateRange = (range?: { startDate: string; endDate: string } | null) => {
    if (!range) {
        return '未记录';
    }

    return `${range.startDate} ~ ${range.endDate}`;
};

export const AllocationStrategyPanel = ({
    onSetStrategy,
    strategy,
}: {
    onSetStrategy: (value: AllocationStrategy) => void;
    strategy: AllocationStrategy;
}) => (
    <section className="rounded-[20px] border border-[color:var(--color-border)] bg-[rgba(255,252,248,0.78)] p-4 shadow-[0_12px_32px_rgba(61,43,31,0.05)]" data-testid="allocation-strategy-panel">
        <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--color-muted)]">配置策略</p>
                <h2 className="mt-2 font-display text-2xl text-[var(--color-foreground)]">选择一个策略</h2>
            </div>
            <Badge tone="accent">{strategyLabelMap[strategy]}</Badge>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4" data-testid="allocation-strategy-options">
            {strategyOptions.map((option) => {
                const isSelected = option.value === strategy;

                return (
                    <Button
                        className={[
                            'h-auto min-h-[86px] justify-start rounded-[14px] border px-4 py-3 text-left',
                            isSelected
                                ? 'border-[var(--color-highlight-soft)] bg-[rgba(156,98,55,0.12)] text-[var(--color-foreground)]'
                                : 'border-[color:var(--color-border)] bg-white/80 text-[var(--color-copy)]',
                        ].join(' ')}
                        data-testid={`allocation-strategy-${option.value}`}
                        key={option.value}
                        onClick={() => {
                            onSetStrategy(option.value);
                        }}
                        tone="ghost"
                        type="button"
                    >
                        <span className="block font-display text-xl">{option.label}</span>
                        <span className="mt-2 block text-sm leading-5 text-[var(--color-muted)]">{option.description}</span>
                    </Button>
                );
            })}
        </div>
    </section>
);

export const AssetSelectionPanel = ({
    filterQuery,
    isLoadingAssets,
    onClearResult,
    onFilterChange,
    onOpenAssetDetail,
    onSelectFirst,
    onToggleSelected,
    selectedAssets,
    selectedAssetIds,
    visibleAssets,
}: {
    filterQuery: string;
    isLoadingAssets: boolean;
    onClearResult: () => void;
    onFilterChange: (value: string) => void;
    onOpenAssetDetail: (assetId: string) => void;
    onSelectFirst: (count: number) => void;
    onToggleSelected: (assetId: string) => void;
    selectedAssets: StoredAsset[];
    selectedAssetIds: string[];
    visibleAssets: StoredAsset[];
}) => {
    const [isDropdownOpen, setDropdownOpen] = useState(false);
    const selectedAssetIdSet = new Set(selectedAssetIds);
    const dropdownAssets = visibleAssets.slice(0, 12);

    return (
        <section className="rounded-[20px] border border-[color:var(--color-border)] bg-[rgba(255,252,248,0.78)] p-4 shadow-[0_12px_32px_rgba(61,43,31,0.05)]">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-[var(--color-muted)]">标的选择</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Badge tone="accent">可见 {visibleAssets.length}</Badge>
                    <Badge tone="muted">已选 {selectedAssetIds.length}</Badge>
                </div>
            </div>

            <div className="mt-3 flex flex-col gap-3 xl:flex-row">
                <div className="relative min-w-0 flex-1">
                    <SearchInput
                        className="flex-1"
                        data-testid="allocation-filter-input"
                        onBlur={() => {
                            setDropdownOpen(false);
                        }}
                        onChange={(value) => {
                            onFilterChange(value);
                            setDropdownOpen(true);
                        }}
                        onFocus={() => {
                            setDropdownOpen(true);
                        }}
                        placeholder="搜索代码、名称、市场或资产类别"
                        value={filterQuery}
                    />
                    {isDropdownOpen && (
                        <div
                            className="absolute left-0 right-0 top-[calc(100%+8px)] z-30 max-h-80 overflow-y-auto rounded-[16px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-strong)] p-2 shadow-[0_18px_40px_rgba(23,19,16,0.14)]"
                            data-testid="allocation-asset-dropdown"
                            onMouseDown={(event) => {
                                event.preventDefault();
                            }}
                        >
                            {isLoadingAssets ? (
                                <div className="rounded-[12px] border border-dashed border-[color:var(--color-border)] bg-[rgba(244,239,230,0.46)] p-3 text-sm text-[var(--color-copy)]">
                                    正在装载资产池...
                                </div>
                            ) : dropdownAssets.length === 0 ? (
                                <div className="rounded-[12px] border border-dashed border-[color:var(--color-border)] bg-[rgba(244,239,230,0.46)] p-3 text-sm text-[var(--color-copy)]">
                                    当前没有匹配标的。
                                </div>
                            ) : (
                                <div className="space-y-1">
                                    {dropdownAssets.map((asset) => {
                                        const isSelected = selectedAssetIdSet.has(asset.id);

                                        return (
                                            <div
                                                className={[
                                                    'flex items-center gap-3 rounded-[12px] border px-3 py-2 transition',
                                                    isSelected
                                                        ? 'border-[var(--color-highlight-soft)] bg-[rgba(156,98,55,0.08)]'
                                                        : 'border-transparent bg-transparent hover:border-[var(--color-highlight-soft)] hover:bg-white/70',
                                                ].join(' ')}
                                                key={asset.id}
                                            >
                                                <Checkbox
                                                    checked={isSelected}
                                                    data-testid={`allocation-asset-toggle-${asset.symbol}`}
                                                    onChange={() => {
                                                        onToggleSelected(asset.id);
                                                    }}
                                                />
                                                <Button
                                                    className="h-auto min-w-0 flex-1 justify-start border-0 bg-transparent px-0 py-0 text-left shadow-none hover:bg-transparent"
                                                    data-testid={`allocation-asset-open-${asset.symbol}`}
                                                    onClick={() => {
                                                        onOpenAssetDetail(asset.id);
                                                    }}
                                                    size="sm"
                                                    tone="ghost"
                                                    type="button"
                                                >
                                                    <span className="block min-w-0 truncate font-display text-lg text-[var(--color-foreground)]">{asset.symbol}（{asset.name}）</span>
                                                    <span className="mt-1 flex flex-wrap gap-1.5">
                                                        <Badge>{asset.market}</Badge>
                                                        <Badge tone="accent">{asset.assetClass}</Badge>
                                                        <Badge>{asset.currency}</Badge>
                                                    </span>
                                                </Button>
                                                <Button
                                                    onClick={() => {
                                                        onOpenAssetDetail(asset.id);
                                                    }}
                                                    size="sm"
                                                    tone="ghost"
                                                >
                                                    详情
                                                </Button>
                                            </div>
                                        );
                                    })}
                                    {visibleAssets.length > dropdownAssets.length && (
                                        <p className="px-3 py-2 text-xs text-[var(--color-muted)]">继续输入以收窄 {visibleAssets.length} 个匹配标的。</p>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button onClick={() => { onSelectFirst(5); }} tone="secondary" data-testid="allocation-select-first-5">
                        选择前 5 个
                    </Button>
                    <Button onClick={() => { onSelectFirst(20); }} tone="secondary" data-testid="allocation-select-first-20">
                        选择前 20 个
                    </Button>
                    <Button
                        onClick={() => {
                            onSelectFirst(0);
                            onClearResult();
                        }}
                        tone="ghost"
                    >清空结果</Button>
                </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2" data-testid="allocation-asset-list">
                {selectedAssets.length === 0 ? (
                    <span className="rounded-[12px] border border-dashed border-[color:var(--color-border)] bg-[rgba(244,239,230,0.46)] px-3 py-2 text-sm text-[var(--color-copy)]">尚未选择标的。</span>
                ) : (
                    selectedAssets.map((asset) => (
                        <Button
                            className="h-auto rounded-full border border-[var(--color-highlight-soft)] bg-[rgba(156,98,55,0.08)] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-highlight)] shadow-none hover:bg-[rgba(156,98,55,0.14)]"
                            data-testid={`allocation-selected-asset-${asset.symbol}`}
                            key={asset.id}
                            onClick={() => {
                                onToggleSelected(asset.id);
                            }}
                            size="sm"
                            tone="ghost"
                            type="button"
                        >
                            {asset.symbol} ×
                        </Button>
                    ))
                )}
            </div>
        </section>
    );
};

export const AllocationControlsPanel = ({
    baseCurrency,
    constraints,
    earliestStartDate,
    endDate,
    isRunning,
    latestEndDate,
    onRunAllocation,
    onSetBaseCurrency,
    onSetDateRange,
    onSetMaxSingleWeight,
    onSetRebalanceCadence,
    onSetTrendFollowingAllowShort,
    onSetTrendFollowingRuleEnabled,
    rebalanceCadence,
    selectedAssets,
    startDate,
    strategy,
    strategyMix,
}: {
    baseCurrency: string;
    constraints: AllocationConstraints;
    earliestStartDate: string;
    endDate: string;
    isRunning: boolean;
    latestEndDate: string;
    onRunAllocation: () => void;
    onSetBaseCurrency: (value: string) => void;
    onSetDateRange: (startDate: string, endDate: string) => void;
    onSetMaxSingleWeight: (value: number) => void;
    onSetRebalanceCadence: (value: RebalanceCadence) => void;
    onSetTrendFollowingAllowShort: (value: boolean) => void;
    onSetTrendFollowingRuleEnabled: (fast: number, value: boolean) => void;
    rebalanceCadence: RebalanceCadence;
    selectedAssets: StoredAsset[];
    startDate: string;
    strategy: AllocationStrategy;
    strategyMix: AllocationStrategyMix;
}) => {
    const trendConfig = resolveTrendFollowingConfig(strategyMix);
    const enabledTrendRuleCount = trendConfig.rules.filter((rule) => rule.enabled).length;
    const isEwmacStrategy = strategy === 'ewmac_trend_following';

    return (
        <section className="rounded-[20px] border border-[color:var(--color-border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.9),rgba(248,243,235,0.82))] p-4 shadow-[0_12px_32px_rgba(61,43,31,0.05)]">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-[var(--color-muted)]">运行参数</p>
                    <h2 className="mt-2 font-display text-2xl text-[var(--color-foreground)]">{strategyLabelMap[strategy]} 参数</h2>
                </div>
                <Badge tone="accent">{strategyLabelMap[strategy]}</Badge>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="space-y-2 text-sm text-[var(--color-copy)]">
                    <span className="text-xs uppercase tracking-[0.24em] text-[var(--color-muted)]">基准货币</span>
                    <Select
                        className="h-10 w-full rounded-[12px] border border-[color:var(--color-border)] bg-white/80 px-3 text-sm text-[var(--color-foreground)]"
                        onChange={(event) => {
                            onSetBaseCurrency(event.currentTarget.value);
                        }}
                        value={baseCurrency}
                    >
                        <option value="CNY">CNY</option>
                        <option value="USD">USD</option>
                        <option value="HKD">HKD</option>
                    </Select>
                </label>

                {!isEwmacStrategy && (
                    <label className="space-y-2 text-sm text-[var(--color-copy)]">
                        <span className="text-xs uppercase tracking-[0.24em] text-[var(--color-muted)]">单标的上限</span>
                        <Input
                            className="h-10 w-full rounded-[12px] border border-[color:var(--color-border)] bg-white/80 px-3 text-sm text-[var(--color-foreground)]"
                            data-testid="allocation-max-single-input"
                            max="0.8"
                            min="0.1"
                            onChange={(event) => {
                                onSetMaxSingleWeight(Number(event.currentTarget.value));
                            }}
                            step="0.01"
                            type="number"
                            value={constraints.maxSingleWeight}
                        />
                    </label>
                )}

                <label className="space-y-2 text-sm text-[var(--color-copy)]">
                    <span className="text-xs uppercase tracking-[0.24em] text-[var(--color-muted)]">调仓频率</span>
                    <Select
                        className="h-10 w-full rounded-[12px] border border-[color:var(--color-border)] bg-white/80 px-3 text-sm text-[var(--color-foreground)]"
                        data-testid="allocation-cadence-select"
                        onChange={(event) => {
                            onSetRebalanceCadence(event.currentTarget.value as RebalanceCadence);
                        }}
                        value={rebalanceCadence}
                    >
                        <option value="none">无调仓</option>
                        <option value="weekly">周度调仓</option>
                        <option value="monthly">月度调仓</option>
                        <option value="quarterly">季度调仓</option>
                    </Select>
                </label>

                <div className="space-y-2 text-sm text-[var(--color-copy)]">
                    <span className="text-xs uppercase tracking-[0.24em] text-[var(--color-muted)]">时间窗口</span>
                    <div className="flex flex-wrap items-center gap-2">
                        {dateWindowPresets.map(({ days, label }) => {
                            const presetStartDate = getPresetStartDate(days);
                            const isActive = startDate === presetStartDate && endDate === latestEndDate;

                            return (
                                <Button
                                    className={[
                                        'h-10 rounded-[12px] border px-3 text-sm transition',
                                        isActive
                                            ? 'border-[var(--color-highlight-soft)] bg-[rgba(156,98,55,0.12)] text-[var(--color-foreground)]'
                                            : 'border-[color:var(--color-border)] bg-white/80 text-[var(--color-copy)] hover:border-[var(--color-highlight-soft)]',
                                    ].join(' ')}
                                    data-testid={`allocation-range-preset-${label}`}
                                    key={label}
                                    onClick={() => {
                                        onSetDateRange(presetStartDate, latestEndDate);
                                    }}
                                    size="sm"
                                    tone="ghost"
                                    type="button"
                                >
                                    {label}
                                </Button>
                            );
                        })}
                    </div>
                    <div className="flex items-center gap-2">
                        <Input
                            className="h-10 min-w-0 flex-1 rounded-[12px] border border-[color:var(--color-border)] bg-white/80 px-3 text-sm text-[var(--color-foreground)]"
                            data-testid="allocation-start-date-input"
                            max={endDate}
                            min={earliestStartDate}
                            onChange={(event) => {
                                onSetDateRange(event.currentTarget.value, endDate);
                            }}
                            type="date"
                            value={startDate}
                        />
                        <span className="text-[var(--color-muted)]">~</span>
                        <Input
                            className="h-10 min-w-0 flex-1 rounded-[12px] border border-[color:var(--color-border)] bg-white/80 px-3 text-sm text-[var(--color-foreground)]"
                            data-testid="allocation-end-date-input"
                            max={latestEndDate}
                            min={startDate}
                            onChange={(event) => {
                                onSetDateRange(startDate, event.currentTarget.value);
                            }}
                            type="date"
                            value={endDate}
                        />
                    </div>
                </div>

                {isEwmacStrategy && (
                    <div className="flex h-10 items-center gap-2 rounded-[12px] border border-[color:var(--color-border)] bg-white/80 px-3 text-sm text-[var(--color-copy)]">
                        <Checkbox
                            checked={trendConfig.allowShort}
                            data-testid="allocation-ewmac-allow-short"
                            onChange={(event) => {
                                onSetTrendFollowingAllowShort(event.currentTarget.checked);
                            }}
                        >
                            允许做空
                        </Checkbox>
                    </div>
                )}

                {isEwmacStrategy && (
                    <div className="rounded-[18px] border border-[color:var(--color-border)] bg-[rgba(244,239,230,0.48)] p-4 md:col-span-2">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <span className="text-xs uppercase tracking-[0.22em] text-[var(--color-muted)]">EWMAC 规则</span>
                            <div className="flex flex-wrap gap-2">
                                <Badge tone="accent">{enabledTrendRuleCount} 条规则</Badge>
                                <Badge tone="muted">100% 趋势策略</Badge>
                            </div>
                        </div>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            {trendConfig.rules.map((rule) => (
                                <Checkbox
                                    checked={rule.enabled}
                                    data-testid={`allocation-ewmac-rule-${rule.fast}-${rule.slow}`}
                                    key={`${rule.fast}-${rule.slow}`}
                                    onChange={(event) => {
                                        onSetTrendFollowingRuleEnabled(rule.fast, event.currentTarget.checked);
                                    }}
                                >
                                    EWMAC {rule.fast}/{rule.slow}
                                </Checkbox>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3">
                <Button
                    className="min-w-[160px]"
                    data-testid="allocation-run-button"
                    onClick={onRunAllocation}
                    tone="primary"
                >
                    {isRunning ? '计算中...' : '运行配置'}
                </Button>
                <Badge>{selectedAssets.length} 个标的</Badge>
                {!isEwmacStrategy && <Badge>{formatPercent(constraints.maxSingleWeight)} 单标的上限</Badge>}
                <Badge>{cadenceLabelMap[rebalanceCadence]}</Badge>
                {isEwmacStrategy && <Badge>{trendConfig.allowShort ? '允许做空' : '仅做多'}</Badge>}
                {isEwmacStrategy && <Badge tone="accent">EWMAC {enabledTrendRuleCount} 条规则</Badge>}
                <Badge>{startDate} ~ {endDate}</Badge>
            </div>

            <div className="mt-4 rounded-[16px] border border-[color:var(--color-border)] bg-[rgba(244,239,230,0.52)] p-4 text-sm leading-6 text-[var(--color-copy)]">
                <p className="text-xs uppercase tracking-[0.24em] text-[var(--color-muted)]">已选资产</p>
                <div className="mt-3 flex flex-wrap gap-2">
                    {selectedAssets.length === 0 ? (
                        <span>尚未选择资产。</span>
                    ) : (
                        selectedAssets.map((asset) => <Badge key={asset.id}>{formatAssetLabel(asset)}</Badge>)
                    )}
                </div>
            </div>
        </section>
    );
};

export const AllocationResultPanel = ({
    onOpenAssetDetail,
    result,
}: {
    onOpenAssetDetail: (assetId: string) => void;
    result: ComponentProps<typeof AllocationVisualizationPanel>['result'] | null;
}) => (
    <section className="rounded-[20px] border border-[color:var(--color-border)] bg-[rgba(255,252,248,0.78)] p-4 shadow-[0_12px_32px_rgba(61,43,31,0.05)]">
        <div className="flex items-start justify-between gap-4">
            <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--color-muted)]">结果视图</p>
                <h2 className="mt-2 font-display text-2xl text-[var(--color-foreground)]">图表总览、相关性与情景分析</h2>
                <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">
                    有效计算时间范围：{result ? formatResultDateRange(result.diagnostics.dateRange) : '待运行后显示'}
                </p>
            </div>
            {result && <Badge tone="accent">{result.diagnostics.optimizer.toUpperCase()}</Badge>}
        </div>

        {!result ? (
            <div className="mt-4 rounded-[16px] border border-dashed border-[color:var(--color-border)] bg-[rgba(244,239,230,0.44)] p-5 text-sm leading-6 text-[var(--color-copy)]">
                运行配置后，这里会显示净值波动图、权重表、仓位饼图、风险贡献柱状图、相关性热力图和情景分析卡片。
            </div>
        ) : (
            <div className="mt-4">
                <AllocationVisualizationPanel onOpenAssetDetail={onOpenAssetDetail} result={result} />
            </div>
        )}
    </section>
);