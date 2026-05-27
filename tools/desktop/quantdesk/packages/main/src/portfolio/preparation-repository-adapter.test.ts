import { describe, expect, test, vi } from 'vitest';

import { PreparationRepositoryAdapter } from './preparation-repository-adapter';

const createAdapter = () => {
    const repositories = {
        assetRepository: { list: vi.fn().mockReturnValue([]) },
        fxRateRepository: { getLatestRate: vi.fn().mockReturnValue(null) },
        priceRepository: {
            getRange: vi.fn().mockReturnValue([{ date: '2026-01-01' }]),
            listByAsset: vi.fn().mockReturnValue([{ date: '2026-01-02' }]),
        },
    };

    return {
        adapter: new PreparationRepositoryAdapter(repositories as never),
        repositories,
    };
};

describe('PreparationRepositoryAdapter', () => {
    test('uses range reads when both start and end dates are provided', () => {
        const { adapter, repositories } = createAdapter();

        const rows = adapter.readPriceHistory({
            assetId: 'asset-a',
            endDate: '2026-01-31',
            startDate: '2026-01-01',
        });

        expect(rows).toEqual([{ date: '2026-01-01' }]);
        expect(repositories.priceRepository.getRange).toHaveBeenCalledWith({
            assetId: 'asset-a',
            endDate: '2026-01-31',
            startDate: '2026-01-01',
        });
        expect(repositories.priceRepository.listByAsset).not.toHaveBeenCalled();
    });

    test('uses full history reads when both date bounds are omitted', () => {
        const { adapter, repositories } = createAdapter();

        const rows = adapter.readPriceHistory({ assetId: 'asset-a' });

        expect(rows).toEqual([{ date: '2026-01-02' }]);
        expect(repositories.priceRepository.listByAsset).toHaveBeenCalledWith('asset-a');
        expect(repositories.priceRepository.getRange).not.toHaveBeenCalled();
    });

    test('rejects partial date ranges instead of widening the query', () => {
        const { adapter, repositories } = createAdapter();

        expect(() => adapter.readPriceHistory({ assetId: 'asset-a', startDate: '2026-01-01' })).toThrow(/both startDate and endDate/u);
        expect(repositories.priceRepository.getRange).not.toHaveBeenCalled();
        expect(repositories.priceRepository.listByAsset).not.toHaveBeenCalled();
    });
});
