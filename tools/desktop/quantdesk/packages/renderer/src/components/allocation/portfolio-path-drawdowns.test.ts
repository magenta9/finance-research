import { describe, expect, test } from 'vitest';

import { buildPortfolioPathDrawdownSeries } from './portfolio-path-drawdowns';

describe('buildPortfolioPathDrawdownSeries', () => {
    test('keeps drawdowns above 5% and ignores shallower post-high pullbacks', () => {
        const { segments, series } = buildPortfolioPathDrawdownSeries([
            { date: '2025-04-11', equity: 1 },
            { date: '2025-04-12', equity: 1.1 },
            { date: '2025-04-13', equity: 1.02 },
            { date: '2025-04-14', equity: 1.03 },
            { date: '2025-04-15', equity: 1.08 },
            { date: '2025-04-16', equity: 1.06 },
            { date: '2025-04-17', equity: 1.12 },
        ]);

        expect(segments).toHaveLength(1);
        expect(segments[0]).toMatchObject({
            endIndex: 2,
            id: 'drawdown-1',
            peakDate: '2025-04-12',
            peakEquity: 1.1,
            startIndex: 1,
            troughDate: '2025-04-13',
            troughEquity: 1.02,
        });
        expect(segments[0].drawdown).toBeCloseTo(0.07272727272727275, 12);
        expect(series.map((point) => point.drawdownSegmentId)).toEqual([
            null,
            'drawdown-1',
            'drawdown-1',
            null,
            null,
            null,
            null,
        ]);
        expect(series[2]).toMatchObject({
            drawdownPeakDate: '2025-04-12',
            drawdownRatio: segments[0].drawdown,
            drawdownTroughDate: '2025-04-13',
        });
        expect(series[5]).toMatchObject({
            drawdownSegmentId: null,
            drawdownRatio: null,
        });
    });
});