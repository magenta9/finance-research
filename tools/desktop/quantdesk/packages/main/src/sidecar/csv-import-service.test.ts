import { describe, expect, test } from 'vitest';

import { CsvImportService } from './csv-import-service';

describe('CsvImportService', () => {
    test('imports valid assets and skips duplicates reported by the repository', () => {
        let firstCreate = true;
        const service = new CsvImportService({
            assets: {
                create() {
                    if (!firstCreate) {
                        throw new Error('UNIQUE constraint failed');
                    }
                    firstCreate = false;
                    return {} as never;
                },
            },
            positions: { save: () => ({}) as never },
            prices: { insertMany: () => undefined },
        });

        const result = service.importAssetsCsv([
            'symbol,name,market,assetClass,currency',
            'SPY,SPDR S&P 500 ETF Trust,US,equity,USD',
            'SPY,SPDR S&P 500 ETF Trust,US,equity,USD',
        ].join('\n'));

        expect(result).toEqual({
            errorCount: 0,
            errors: [],
            skippedCount: 1,
            successCount: 1,
        });
    });

    test('imports positions and surfaces row errors', () => {
        const service = new CsvImportService({
            assets: { create: () => ({}) as never },
            positions: {
                save(position) {
                    if (position.assetId === 'bad-asset') {
                        throw new Error('missing asset');
                    }
                    return {} as never;
                },
            },
            prices: { insertMany: () => undefined },
        });

        const result = service.importPositionsCsv([
            { assetId: 'good-asset', costBasis: null, currency: 'USD', shares: 1 },
            { assetId: 'bad-asset', costBasis: null, currency: 'USD', shares: 1 },
        ]);

        expect(result.successCount).toBe(1);
        expect(result.errorCount).toBe(1);
        expect(result.errors).toEqual(['missing asset']);
    });
});