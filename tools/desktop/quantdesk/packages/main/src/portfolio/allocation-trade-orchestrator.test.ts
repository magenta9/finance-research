import { describe, expect, test } from 'vitest';

import type { AllocationTrade } from '@quantdesk/shared';

import {
    aggregateAllocationTradeSources,
    isMaterialAllocationTradeChange,
    scaleAllocationTrade,
} from './allocation-trade-orchestrator';

const trade: AllocationTrade = {
    action: 'open_long',
    assetId: 'asset-a',
    date: '2026-01-01',
    fromWeight: 0.2,
    name: 'Asset A',
    reason: '配置建仓',
    source: 'allocation',
    symbol: 'AAA',
    toWeight: 0.6,
    weightChange: 0.4,
};

describe('allocation trade orchestrator', () => {
    test('identifies material trade changes using the portfolio threshold', () => {
        expect(isMaterialAllocationTradeChange(0.0001)).toBe(true);
        expect(isMaterialAllocationTradeChange(0.000099)).toBe(false);
        expect(isMaterialAllocationTradeChange(-0.0001)).toBe(true);
    });

    test('scales trade weights consistently', () => {
        expect(scaleAllocationTrade(trade, 0.5)).toEqual(expect.objectContaining({
            fromWeight: 0.1,
            toWeight: 0.3,
            weightChange: 0.2,
        }));
    });

    test('aggregates scaled trade sources and filters immaterial trades', () => {
        const tinyTrade = { ...trade, assetId: 'tiny', weightChange: 0.00001 };
        const trendTrade = { ...trade, assetId: 'trend', source: 'trend_following' as const };

        const result = aggregateAllocationTradeSources({
            sources: [
                { trades: [trade, tinyTrade], weightScale: 0.5 },
                { trades: [trendTrade] },
            ],
        });

        expect(result).toHaveLength(2);
        expect(result[0]).toEqual(expect.objectContaining({
            assetId: 'asset-a',
            toWeight: 0.3,
            weightChange: 0.2,
        }));
        expect(result[1]).toEqual(trendTrade);
    });
});
