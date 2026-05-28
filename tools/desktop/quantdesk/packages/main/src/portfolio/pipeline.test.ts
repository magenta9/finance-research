import { describe, expect, test, vi } from 'vitest';

import type { AllocationConstraints, StoredAsset } from '@quantdesk/shared';

import type { AllocationPreparationService } from './preparation-service';
import { PortfolioAllocationPipeline } from './pipeline';
import { buildAsset, buildDateRange } from './portfolio-test-support';
import { defaultAllocationStrategyRegistry } from './strategy-registry';

const buildSeries = (basePrice: number, length = 90) =>
    Array.from({ length }, (_, index) =>
        Number((basePrice * (1 + index * 0.0025) * (1 + Math.sin(index / 7) * 0.018)).toFixed(4)));

const buildTrendSeries = (basePrice: number, drift: number, length: number) =>
    Array.from({ length }, (_, index) => Number((basePrice * (1 + drift) ** index).toFixed(4)));

const buildPreparedSuccess = ({
    assets,
    length = 90,
    priceSeries,
    warnings = [],
}: {
    assets: StoredAsset[];
    length?: number;
    priceSeries?: number[][];
    warnings?: string[];
}) => {
    const alignedDates = buildDateRange(length);

    return {
        calculationDateRange: {
            endDate: alignedDates.at(-1) ?? alignedDates[0],
            startDate: alignedDates[0],
        },
        effectiveDateRange: {
            endDate: alignedDates.at(-1) ?? alignedDates[0],
            startDate: alignedDates[0],
        },
        ok: true as const,
        prepared: {
            alignedDates,
            assetDateCoverage: assets.map((asset) => ({
                actualEndDate: alignedDates.at(-1) ?? alignedDates[0],
                actualStartDate: alignedDates[0],
                assetId: asset.id,
                isFallback: false,
                requestedStartDate: alignedDates[0],
                symbol: asset.symbol,
                tradingDays: alignedDates.length,
            })),
            excludedAssets: [],
            series: assets.map((asset, index) => ({
                annualizedReturn: 0,
                annualizedVolatility: 0,
                asset,
                prices: priceSeries?.[index] ?? buildSeries(80 + index * 15, length),
            })),
            warnings,
        },
    };
};

const buildPreparationFailure = () => ({
    calculationDateRange: {
        endDate: '2024-03-31',
        startDate: '2024-01-01',
    },
    error: {
        code: 'INSUFFICIENT_HISTORY' as const,
        message: '已选标的在当前窗口内的共同覆盖不足 61 个交易日。',
        suggestions: ['缩短时间窗口。', '减少已选标的数量。'],
    },
    ok: false as const,
    prepared: {
        alignedDates: [],
        assetDateCoverage: [],
        excludedAssets: ['asset-a'],
        series: [],
        warnings: ['SPY 历史数据不足 60 个交易日。'],
    },
});

const baseConstraints: AllocationConstraints = {
    allowLeverage: false,
    allowShort: false,
    maxClassWeight: {},
    maxSingleWeight: 0.5,
};

const createPipeline = ({
    preparationResult,
    sidecarResponse,
}: {
    preparationResult: Awaited<ReturnType<AllocationPreparationService['prepare']>>;
    sidecarResponse?: unknown;
}) => {
    const preparationService = {
        prepare: vi.fn().mockResolvedValue(preparationResult),
    } as unknown as AllocationPreparationService;
    const sidecarManager = {
        call: vi.fn().mockResolvedValue(sidecarResponse),
    };

    return {
        pipeline: new PortfolioAllocationPipeline(preparationService, sidecarManager as never),
        preparationService,
        sidecarManager,
    };
};

describe('portfolio allocation pipeline', () => {
    test('registers every allocation strategy identity', () => {
        expect(Object.keys(defaultAllocationStrategyRegistry).sort()).toEqual([
            'active_dual_momentum_gtaa',
            'erc',
            'ewmac_trend_following',
            'inverse_volatility',
            'max_diversification',
        ]);
    });

    test('returns an explicit error when a strategy handler is missing', async () => {
        const assets = [
            buildAsset('asset-a', 'SPY', 'equity'),
            buildAsset('asset-b', 'AGG', 'fixed_income'),
        ];
        const { preparationService, sidecarManager } = createPipeline({
            preparationResult: buildPreparedSuccess({ assets }),
        });
        const registry = { ...defaultAllocationStrategyRegistry };
        delete (registry as Partial<typeof registry>).active_dual_momentum_gtaa;
        const pipeline = new PortfolioAllocationPipeline(preparationService, sidecarManager as never, registry as never);

        const outcome = await pipeline.allocate({
            assetIds: assets.map((asset) => asset.id),
            baseCurrency: 'USD',
            constraints: baseConstraints,
            mode: 'inverse_volatility',
            strategy: 'active_dual_momentum_gtaa',
        });

        expect(outcome.meta.stage).toBe('constraint_failed');
        expect(outcome.meta.optimizerPath).toBeNull();
        expect(outcome.result.error).toEqual(expect.objectContaining({ code: 'UNSUPPORTED_STRATEGY' }));
    });

    test('returns a structured error when a strategy handler throws', async () => {
        const assets = [
            buildAsset('asset-a', 'SPY', 'equity'),
            buildAsset('asset-b', 'AGG', 'fixed_income'),
        ];
        const { preparationService, sidecarManager } = createPipeline({
            preparationResult: buildPreparedSuccess({ assets }),
        });
        const pipeline = new PortfolioAllocationPipeline(preparationService, sidecarManager as never, {
            ...defaultAllocationStrategyRegistry,
            erc: { run: vi.fn().mockRejectedValue(new Error('strategy blew up')) },
        });

        const outcome = await pipeline.allocate({
            assetIds: assets.map((asset) => asset.id),
            baseCurrency: 'USD',
            constraints: baseConstraints,
            mode: 'erc',
        });

        expect(outcome.meta.stage).toBe('optimization_failed');
        expect(outcome.meta.optimizerPath).toBeNull();
        expect(outcome.result.error).toEqual(expect.objectContaining({
            code: 'ALLOCATION_STRATEGY_FAILED',
            message: 'strategy blew up',
        }));
    });

    test('returns completed outcome with js optimizer path on success', async () => {
        const assets = [
            buildAsset('asset-a', 'SPY', 'equity'),
            buildAsset('asset-b', 'AGG', 'fixed_income'),
        ];
        const { pipeline } = createPipeline({
            preparationResult: buildPreparedSuccess({ assets }),
        });

        const outcome = await pipeline.allocate({
            assetIds: ['asset-a', 'asset-b'],
            baseCurrency: 'USD',
            constraints: baseConstraints,
            mode: 'erc',
        });

        expect(outcome.meta.stage).toBe('completed');
        expect(outcome.meta.optimizerPath).toBe('js');
        expect(outcome.result.error).toBeUndefined();
        expect(outcome.result.portfolioPath).toHaveLength(90);
        expect(outcome.result.portfolioPath?.[0]).toEqual({ date: '2024-01-01', equity: 1 });
        expect(outcome.dateWindow.calculation).toEqual(outcome.dateWindow.effective);
    });

    test('routes explicit configuration strategy through the registry identity', async () => {
        const assets = [
            buildAsset('asset-a', 'SPY', 'equity'),
            buildAsset('asset-b', 'AGG', 'fixed_income'),
            buildAsset('asset-c', 'GLD', 'commodity'),
        ];
        const { pipeline } = createPipeline({
            preparationResult: buildPreparedSuccess({ assets }),
        });

        const outcome = await pipeline.allocate({
            assetIds: ['asset-a', 'asset-b', 'asset-c'],
            baseCurrency: 'USD',
            constraints: baseConstraints,
            mode: 'erc',
            strategy: 'max_diversification',
        });

        expect(outcome.meta.stage).toBe('completed');
        expect(outcome.result.mode).toBe('max_diversification');
        expect(outcome.result.strategy).toBe('max_diversification');
        expect(outcome.result.diagnostics.strategy).toBe('max_diversification');
    });

    test('runs EWMAC as a top-level full trend-following strategy', async () => {
        const assets = [
            buildAsset('asset-a', 'SPY', 'equity'),
            buildAsset('asset-b', 'AGG', 'fixed_income'),
        ];
        const { pipeline } = createPipeline({
            preparationResult: buildPreparedSuccess({ assets }),
        });

        const outcome = await pipeline.allocate({
            assetIds: ['asset-a', 'asset-b'],
            baseCurrency: 'USD',
            constraints: baseConstraints,
            mode: 'inverse_volatility',
            strategy: 'ewmac_trend_following',
            strategyMix: {
                trendFollowing: {
                    enabled: true,
                    sleeveWeight: 0.25,
                },
            },
        });

        expect(outcome.meta.stage).toBe('completed');
        expect(outcome.result.strategy).toBe('ewmac_trend_following');
        expect(outcome.result.diagnostics.strategyMix?.allocationSleeveWeight).toBe(0);
        expect(outcome.result.diagnostics.strategyMix?.trendFollowing?.sleeveWeight).toBe(1);
        expect(outcome.result.diagnostics.strategyMix?.trendFollowing?.rules).toHaveLength(6);
        expect(outcome.result.diagnostics.strategyMix?.trendFollowing?.ruleSlotCount).toBe(12);
        expect(outcome.result.diagnostics.trendFollowing?.assets).toHaveLength(2);
        expect(outcome.result.portfolioPath?.[1]).toEqual(expect.objectContaining({
            allocationEquity: expect.any(Number),
            trendFollowingEquity: expect.any(Number),
        }));
    });

    test('runs Active Dual Momentum for mixed ETF and futures pools', async () => {
        const length = 520;
        const assets = [
            buildAsset('asset-etf-up', 'SPY', 'equity', { market: 'US' }),
            buildAsset('asset-etf-down', 'TLT', 'fixed_income', { market: 'US' }),
            buildAsset('asset-future-up', 'RB9999', 'commodity', { market: 'COMMODITY', metadata: { instrumentType: 'future' } }),
            buildAsset('asset-future-down', 'FU9999', 'commodity', { market: 'COMMODITY', metadata: { instrumentType: 'future' } }),
        ];
        const { pipeline, preparationService } = createPipeline({
            preparationResult: buildPreparedSuccess({
                assets,
                length,
                priceSeries: [
                    buildTrendSeries(100, 0.0012, length),
                    buildTrendSeries(120, -0.0002, length),
                    buildTrendSeries(80, 0.0015, length),
                    buildTrendSeries(90, -0.0018, length),
                ],
            }),
        });

        const outcome = await pipeline.allocate({
            assetIds: assets.map((asset) => asset.id),
            baseCurrency: 'USD',
            constraints: baseConstraints,
            mode: 'inverse_volatility',
            strategy: 'active_dual_momentum_gtaa',
        });

        expect(outcome.meta.stage).toBe('completed');
        expect(outcome.result.error).toBeUndefined();
        expect(outcome.result.strategy).toBe('active_dual_momentum_gtaa');
        expect(outcome.result.diagnostics.activeDualMomentum?.status).toBe('ok');
        expect(outcome.result.diagnostics.activeDualMomentum?.rebalanceRecords.length).toBeGreaterThan(26);
        expect(outcome.result.diagnostics.activeDualMomentum?.rebalanceRecords.at(-1)?.holdings).toEqual(expect.arrayContaining([
            expect.objectContaining({ direction: 'short', symbol: 'FU9999' }),
            expect.objectContaining({ direction: 'long', symbol: 'RB9999' }),
        ]));
        expect(outcome.result.portfolioPath).toHaveLength(length);
        expect(preparationService.prepare).toHaveBeenCalledWith(expect.objectContaining({
            warmupDays: 203,
        }));
    });

    test('configuration strategies ignore legacy allocation sleeve subsets', async () => {
        const assets = [
            buildAsset('asset-a', 'SPY', 'equity'),
            buildAsset('asset-b', 'AGG', 'fixed_income'),
            buildAsset('asset-c', 'GLD', 'commodity'),
        ];
        const { pipeline } = createPipeline({
            preparationResult: buildPreparedSuccess({ assets }),
        });

        const outcome = await pipeline.allocate({
            assetIds: ['asset-a', 'asset-b', 'asset-c'],
            baseCurrency: 'USD',
            constraints: baseConstraints,
            mode: 'inverse_volatility',
            strategyMix: {
                allocation: {
                    assetIds: ['asset-a', 'asset-b'],
                },
            },
        });

        expect(outcome.meta.stage).toBe('completed');
        expect(outcome.result.diagnostics.strategyMix).toBeUndefined();
        expect(outcome.result.weights['asset-c']).toBeGreaterThan(0);
        expect(outcome.result.weights['asset-a']).toBeGreaterThan(0);
        expect(outcome.result.weights['asset-b']).toBeGreaterThan(0);
    });

    test('returns preparation_failed outcome while preserving effective window', async () => {
        const { pipeline, sidecarManager } = createPipeline({
            preparationResult: buildPreparationFailure(),
        });

        const outcome = await pipeline.allocate({
            assetIds: ['asset-a'],
            baseCurrency: 'USD',
            constraints: baseConstraints,
            mode: 'erc',
        });

        expect(sidecarManager.call).not.toHaveBeenCalled();
        expect(outcome.meta.stage).toBe('preparation_failed');
        expect(outcome.meta.optimizerPath).toBeNull();
        expect(outcome.meta.warnings).toEqual(['SPY 历史数据不足 60 个交易日。']);
        expect(outcome.dateWindow.effective).toEqual({
            endDate: '2024-03-31',
            startDate: '2024-01-01',
        });
    });

    test('returns optimization_failed outcome for infeasible constraints', async () => {
        const assets = [
            buildAsset('asset-1', 'SPY', 'equity'),
            buildAsset('asset-2', 'AGG', 'fixed_income'),
            buildAsset('asset-3', 'GLD', 'commodity'),
        ];
        const { pipeline } = createPipeline({
            preparationResult: buildPreparedSuccess({ assets }),
        });

        const outcome = await pipeline.allocate({
            assetIds: ['asset-1', 'asset-2', 'asset-3'],
            baseCurrency: 'USD',
            constraints: {
                ...baseConstraints,
                maxClassWeight: {
                    commodity: 0.2,
                    equity: 0.2,
                    fixed_income: 0.2,
                },
                maxSingleWeight: 0.3,
            },
            mode: 'erc',
        });

        expect(outcome.meta.stage).toBe('optimization_failed');
        expect(outcome.meta.optimizerPath).toBe('js');
        expect(outcome.result.error).toEqual(expect.objectContaining({ code: 'INFEASIBLE_CONSTRAINTS' }));
    });
});