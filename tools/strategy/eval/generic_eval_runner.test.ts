import { describe, expect, test } from 'vitest';

import { prepareEvalData } from './eval_preparation';
import { projectAllocationResult } from './eval_result_projector';
import { resolveAllocationMode, resolveRebalanceCadence } from './eval_runner_contract';
import { resolveStrategyHandler } from './eval_strategy_adapter';

const dateAt = (index: number) => {
    const date = new Date(Date.UTC(2025, 0, 1 + index));
    return date.toISOString().slice(0, 10);
};

const rows = (length: number, start: number) => ({
    prices: Array.from({ length }, (_value, index) => ({
        adjustedClose: start + index * 0.5,
        calculationClose: index === 0 ? start + 10 : null,
        close: start + index,
        date: dateAt(index),
    })),
});

describe('strategy eval adapter contract', () => {
    test('resolves canonical strategy handlers from allocation-engine registry', () => {
        expect(resolveStrategyHandler('erc')).toBeTruthy();
        expect(resolveStrategyHandler('active_dual_momentum_gtaa')).toBeTruthy();
        expect(resolveStrategyHandler('max_diversification_research_v1')).toBeTruthy();
    });

    test('prepares aligned price data from quant-data cache', () => {
        const asset = {
            assetClass: 'equity' as const,
            createdAt: '',
            currency: 'CNY' as const,
            id: 'asset-a',
            market: 'A' as const,
            metadata: {},
            name: 'AAA',
            symbol: 'AAA',
            tags: [],
            updatedAt: '',
        };
        const prepared = prepareEvalData({
            assetBySymbol: new Map([['AAA', asset], ['BBB', { ...asset, id: 'asset-b', symbol: 'BBB' }]]),
            pricesBySymbol: {
                AAA: rows(62, 100),
                BBB: rows(62, 80),
            },
            symbols: ['AAA', 'BBB'],
        });

        expect(prepared.alignedDates).toHaveLength(62);
        expect(prepared.series[0]?.prices[0]).toBe(110);
    });

    test('projects allocation errors into eval rows', () => {
        const row = projectAllocationResult({
            evalCase: {
                basketSize: 2,
                caseId: 'case-1',
                endDate: '2026-05-27',
                sampleIndex: 0,
                startDate: '2025-05-27',
                symbols: ['AAA', 'BBB'],
                windowYears: 1,
            },
            result: {
                allocations: [],
                baseCurrency: 'CNY',
                correlationMatrix: { labels: [], matrix: [] },
                diagnostics: {
                    alignedDates: 0,
                    assetDateCoverage: [],
                    dateRange: { endDate: '2026-05-27', startDate: '2025-05-27' },
                    excludedAssets: [],
                    metricComputation: 'portfolio_path_simulation',
                    optimizer: 'js',
                    rebalanceEventCount: 0,
                    strategy: 'erc',
                    warnings: [],
                },
                error: {
                    code: 'OPTIMIZATION_FAILED',
                    message: 'failed',
                    suggestions: [],
                },
                generatedAt: '2026-05-28T00:00:00.000Z',
                mode: 'erc',
                portfolioMetrics: {
                    expectedReturn: 0,
                    maxDrawdown: 0,
                    sharpeRatio: 0,
                    volatility: 0,
                },
                strategy: 'erc',
                weights: [],
            },
            strategyRun: { strategyId: 'erc' },
        });

        expect(row.status).toBe('error');
        expect(row.error).toBe('failed');
    });

    test('resolves allocation mode and cadence defaults', () => {
        expect(resolveAllocationMode('max_diversification_research_v1')).toBe('max_diversification');
        expect(resolveRebalanceCadence({
            basketSize: 2,
            caseId: 'case-1',
            endDate: '2026-05-27',
            sampleIndex: 0,
            startDate: '2025-05-27',
            symbols: ['AAA', 'BBB'],
            windowYears: 1,
        }, 'active_dual_momentum_gtaa')).toBe('weekly');
    });
});
