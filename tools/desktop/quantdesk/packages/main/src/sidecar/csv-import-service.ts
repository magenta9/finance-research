import crypto from 'node:crypto';

import type {
    AssetInput,
    CsvImportResult,
    DailyPriceInput,
    PositionImportRow,
} from '@quantdesk/shared';

import type { Repositories } from '../db/repositories';

export interface CsvImportDeps {
    assets: Pick<Repositories['assetRepository'], 'create'>;
    positions: Pick<Repositories['positionRepository'], 'save'>;
    prices: Pick<Repositories['priceRepository'], 'insertMany'>;
}

export const parseCsv = (csvText: string) =>
    csvText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.split(',').map((column) => column.trim()));

export class CsvImportService {
    private readonly deps: CsvImportDeps;

    constructor(deps: CsvImportDeps) {
        this.deps = deps;
    }

    importAssetsCsv(csvText: string): CsvImportResult {
        const [header, ...rows] = parseCsv(csvText);

        if (!header || header.join(',') !== 'symbol,name,market,assetClass,currency') {
            return {
                errorCount: 1,
                errors: ['CSV header must be symbol,name,market,assetClass,currency'],
                skippedCount: 0,
                successCount: 0,
            };
        }

        let successCount = 0;
        let skippedCount = 0;
        let errorCount = 0;
        const errors: string[] = [];

        for (const row of rows) {
            const [symbol, name, market, assetClass, currency] = row;

            try {
                const input: AssetInput = {
                    assetClass: assetClass as AssetInput['assetClass'],
                    currency: currency as AssetInput['currency'],
                    id: crypto.randomUUID(),
                    market: market as AssetInput['market'],
                    metadata: {},
                    name,
                    symbol,
                    tags: [],
                };

                this.deps.assets.create(input);
                successCount += 1;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);

                if (message.includes('UNIQUE')) {
                    skippedCount += 1;
                    continue;
                }

                errorCount += 1;
                errors.push(message);
            }
        }

        return {
            errorCount,
            errors,
            skippedCount,
            successCount,
        };
    }

    importPricesCsv(assetId: string, csvText: string): CsvImportResult {
        const [header, ...rows] = parseCsv(csvText);

        if (!header || header.join(',') !== 'date,open,high,low,close,volume,adjustedClose') {
            return {
                errorCount: 1,
                errors: ['CSV header must be date,open,high,low,close,volume,adjustedClose'],
                skippedCount: 0,
                successCount: 0,
            };
        }

        const inserts: DailyPriceInput[] = rows.map((row) => ({
            adjustedClose: Number(row[6] ?? 0),
            assetId,
            close: Number(row[4] ?? 0),
            date: row[0] ?? '',
            high: Number(row[2] ?? 0),
            low: Number(row[3] ?? 0),
            open: Number(row[1] ?? 0),
            source: 'csv',
            volume: Number(row[5] ?? 0),
        }));

        this.deps.prices.insertMany(inserts);

        return {
            errorCount: 0,
            errors: [],
            skippedCount: 0,
            successCount: inserts.length,
        };
    }

    importPositionsCsv(rows: PositionImportRow[]): CsvImportResult {
        let successCount = 0;
        const errors: string[] = [];

        for (const row of rows) {
            try {
                this.deps.positions.save({
                    assetId: row.assetId,
                    costBasis: row.costBasis,
                    currency: row.currency,
                    id: crypto.randomUUID(),
                    portfolioName: row.portfolioName ?? 'default',
                    shares: row.shares,
                });
                successCount += 1;
            } catch (error) {
                errors.push(error instanceof Error ? error.message : String(error));
            }
        }

        return {
            errorCount: errors.length,
            errors,
            skippedCount: 0,
            successCount,
        };
    }
}