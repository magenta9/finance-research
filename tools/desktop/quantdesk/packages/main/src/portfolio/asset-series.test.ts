import { describe, expect, test } from 'vitest';

import { resolveAssetSeries } from './asset-series';

const buildPrices = (
    values: Array<{
        close: number | null;
        adjustedClose: number | null;
        source?: string;
    }>,
) => values.map((value, index) => ({
    adjustedClose: value.adjustedClose,
    close: value.close,
    date: `2025-01-${String(index + 1).padStart(2, '0')}`,
    source: value.source ?? 'akshare',
}));

describe('resolveAssetSeries', () => {
    test('uses close as the unified analysis series and disables raw observation switching', () => {
        const result = resolveAssetSeries(buildPrices([
            { adjustedClose: 101, close: 100 },
            { adjustedClose: 102, close: 100.5 },
            { adjustedClose: 104, close: 101 },
        ]));

        expect(result.preferredDisplaySeries).toBe('close');
        expect(result.analysisSeries).toBe('close');
        expect(result.analyticsAvailability).toBe('ok');
        expect(result.degradationReason).toBeNull();
        expect(result.canShowRawObservation).toBe(false);
        expect(result.points[0]).toMatchObject({
            analysisValue: 100,
            displayValueForAnalysisMode: 100,
            displayValueForRawMode: 100,
        });
    });

    test('keeps close as the unified analysis series even when adjusted close coverage is incomplete', () => {
        const prices = buildPrices(Array.from({ length: 20 }, (_, index) => ({
            adjustedClose: index < 3 ? null : 101 + index,
            close: 100 + index,
        })));
        const result = resolveAssetSeries(prices);

        expect(result.preferredDisplaySeries).toBe('close');
        expect(result.analysisSeries).toBe('close');
        expect(result.analyticsAvailability).toBe('ok');
        expect(result.degradationReason).toBeNull();
        expect(result.adjustedCloseMissingRatio).toBeGreaterThan(0.1);
        expect(result.canShowRawObservation).toBe(false);
    });

    test('uses akshare nav series directly for analytics', () => {
        const result = resolveAssetSeries(buildPrices([
            { adjustedClose: 1.01, close: 1.01, source: 'akshare-nav' },
            { adjustedClose: 1.03, close: 1.03, source: 'akshare-nav' },
            { adjustedClose: 1.02, close: 1.02, source: 'akshare-nav' },
        ]));

        expect(result.preferredDisplaySeries).toBe('close');
        expect(result.analysisSeries).toBe('close');
        expect(result.analyticsAvailability).toBe('ok');
        expect(result.degradationReason).toBeNull();
        expect(result.canShowRawObservation).toBe(false);
        expect(result.points.every((point) => point.analysisValue != null)).toBe(true);
    });
});