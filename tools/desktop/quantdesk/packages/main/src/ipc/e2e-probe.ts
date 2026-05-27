import crypto from 'node:crypto';

import type { AssetInput, AssetLookupResult, CsvImportResult } from '@quantdesk/shared';

import type { Repositories } from '../db/repositories';

export interface E2eProbeStrategy {
    isEnabled: boolean;
    importAssetsCsv: (csvText: string) => CsvImportResult;
    lookupAssets: (query: string, market?: string) => AssetLookupResult[];
}

const assetLookupFixtures: AssetLookupResult[] = [
    {
        assetClass: 'equity',
        currency: 'USD',
        exchange: 'NYSE Arca',
        market: 'US',
        metadata: { aliases: ['S&P 500', '标普500'] },
        name: 'SPDR S&P 500 ETF Trust',
        source: 'e2e-fixture',
        symbol: 'SPY',
    },
    {
        assetClass: 'equity',
        currency: 'CNY',
        exchange: 'SSE',
        market: 'A',
        metadata: { aliases: ['沪深300', 'CSI 300'] },
        name: '沪深300ETF',
        source: 'e2e-fixture',
        symbol: '510300',
    },
    {
        assetClass: 'equity',
        currency: 'CNY',
        exchange: 'SZSE',
        market: 'A',
        metadata: { aliases: ['沪深300', 'CSI 300'] },
        name: '嘉实沪深300ETF',
        source: 'e2e-fixture',
        symbol: '159919',
    },
];

export const createE2eProbe = (
    assetRepository: Pick<Repositories['assetRepository'], 'create' | 'list'>,
    isEnabled: boolean,
): E2eProbeStrategy | null => {
    if (!isEnabled) {
        return null;
    }

    return {
        importAssetsCsv(csvText: string): CsvImportResult {
            const lines = csvText
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean);
            const [header, ...rows] = lines;

            if (header !== 'symbol,name,market,assetClass,currency') {
                return {
                    errorCount: 1,
                    errors: ['CSV 头必须是 symbol,name,market,assetClass,currency'],
                    skippedCount: 0,
                    successCount: 0,
                };
            }

            let successCount = 0;
            let skippedCount = 0;
            const errors: string[] = [];

            for (const row of rows) {
                const [symbol, name, market, assetClass, currency] = row.split(',').map((entry) => entry.trim());

                if (!symbol || !name || !market || !assetClass || !currency) {
                    errors.push(`无效行: ${row}`);
                    continue;
                }

                const duplicate = assetRepository.list().some(
                    (asset) => asset.symbol === symbol && asset.market === market,
                );

                if (duplicate) {
                    skippedCount += 1;
                    continue;
                }

                assetRepository.create({
                    assetClass: assetClass as AssetInput['assetClass'],
                    currency: currency as AssetInput['currency'],
                    id: crypto.randomUUID(),
                    market: market as AssetInput['market'],
                    metadata: { source: 'e2e-fixture-import' },
                    name,
                    symbol,
                    tags: [],
                });
                successCount += 1;
            }

            return {
                errorCount: errors.length,
                errors,
                skippedCount,
                successCount,
            };
        },
        isEnabled: true,
        lookupAssets(query: string, market?: string) {
            const normalizedQuery = query.trim().toLowerCase();

            return assetLookupFixtures.filter((asset) => {
                const aliases = Array.isArray(asset.metadata.aliases) ? asset.metadata.aliases : [];
                const matchesQuery = [asset.symbol, asset.name, ...aliases]
                    .some((value) => String(value).toLowerCase().includes(normalizedQuery));
                const matchesMarket = !market || asset.market === market;

                return matchesQuery && matchesMarket;
            });
        },
    };
};