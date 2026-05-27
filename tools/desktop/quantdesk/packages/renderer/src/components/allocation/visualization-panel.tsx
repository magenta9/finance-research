import { memo, useMemo } from 'react';

import type { AllocationResult } from '@quantdesk/shared';

import { Badge } from '../badge';
import { AllocationVisualizationSections } from './allocation-visualization-sections';
import { MetricCard } from './metric-card';
import { buildPortfolioPathDrawdownSeries } from './portfolio-path-drawdowns';

const cadenceLabelMap = {
    monthly: '月度调仓',
    none: '买入持有',
    quarterly: '季度调仓',
    weekly: '周度调仓',
} as const;

const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`;

interface AllocationVisualizationPanelProps {
    onOpenAssetDetail: (assetId: string) => void;
    result: AllocationResult;
}

const AllocationVisualizationPanelComponent = ({
    onOpenAssetDetail,
    result,
}: AllocationVisualizationPanelProps) => {
    const maxWeight = result.allocations.reduce(
        (currentMax, allocation) => Math.max(currentMax, allocation.weight),
        0,
    );
    const portfolioPath = useMemo(
        () => result.portfolioPath ?? [],
        [result.portfolioPath],
    );
    const portfolioPathWithDrawdowns = useMemo(
        () => buildPortfolioPathDrawdownSeries(portfolioPath),
        [portfolioPath],
    );
    const scenarioAnalysis = result.scenarioAnalysis ?? [];
    const assetCoverageById = new Map(
        (result.diagnostics.assetDateCoverage ?? []).map((coverage) => [coverage.assetId, coverage]),
    );
    const assetIdBySymbol = new Map(result.allocations.map((allocation) => [allocation.symbol, allocation.assetId]));
    const correlationLabels = result.correlationMatrix.labels;
    const fallbackAssetIds = new Set(
        (result.diagnostics.assetDateCoverage ?? [])
            .filter((coverage) => coverage.isFallback)
            .map((coverage) => coverage.assetId),
    );
    const chartRows = result.allocations.map((allocation) => ({
        riskContribution: Number((allocation.riskContribution * 100).toFixed(2)),
        symbol: allocation.symbol,
        weight: Number((allocation.weight * 100).toFixed(2)),
    }));

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-2">
                <Badge tone="accent">
                    {cadenceLabelMap[result.rebalanceCadence]}
                    {result.diagnostics.rebalanceEventCount != null ? ` · ${result.diagnostics.rebalanceEventCount} 次` : ''}
                </Badge>
                {result.diagnostics.metricComputation === 'portfolio_path_simulation' && <Badge>路径模拟口径</Badge>}
            </div>

            <div className="grid gap-4 md:grid-cols-4">
                <MetricCard hint="基于组合实现路径年化后的收益表现。" label="预期收益" value={formatPercent(result.portfolioMetrics.expectedReturn)} />
                <MetricCard hint="基于组合实现路径日收益估算的年化波动。" label="年化波动" value={formatPercent(result.portfolioMetrics.volatility)} />
                <MetricCard hint="路径模拟口径下的收益与波动简化比值。" label="夏普比率" value={result.portfolioMetrics.sharpeRatio.toFixed(2)} />
                <MetricCard hint="基于同一条组合净值路径推导的最大回撤。" label="最大回撤" value={formatPercent(result.portfolioMetrics.maxDrawdown)} />
            </div>

            <AllocationVisualizationSections
                assetCoverageById={assetCoverageById}
                assetIdBySymbol={assetIdBySymbol}
                chartRows={chartRows}
                correlationLabels={correlationLabels}
                fallbackAssetIds={fallbackAssetIds}
                onOpenAssetDetail={onOpenAssetDetail}
                portfolioPath={portfolioPath}
                portfolioPathWithDrawdowns={portfolioPathWithDrawdowns}
                result={result}
                scenarioAnalysis={scenarioAnalysis}
            />

            <div className="sr-only" data-testid="allocation-expected-return-value">{result.portfolioMetrics.expectedReturn.toFixed(8)}</div>
            <div className="sr-only" data-testid="allocation-max-weight">{maxWeight.toFixed(6)}</div>
            <div className="sr-only" data-testid="allocation-optimizer">{result.diagnostics.optimizer}</div>
            <div className="sr-only" data-testid="allocation-scenario-count">{scenarioAnalysis.length}</div>
            <div className="sr-only" data-testid="allocation-weights-symbols">{result.allocations.map((allocation) => allocation.symbol).join(',')}</div>
        </div>
    );
};

export const AllocationVisualizationPanel = memo(AllocationVisualizationPanelComponent);

AllocationVisualizationPanel.displayName = 'AllocationVisualizationPanel';
