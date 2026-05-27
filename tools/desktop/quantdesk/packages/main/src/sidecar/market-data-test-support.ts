import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { DailyPriceRecord, FxRateRecord, StoredAsset } from '@quantdesk/shared';

import type { DataServices } from '../db/services';
import { preferenceKeys } from '../preferences/preference-keys';
import { resolveSidecarPythonCommand } from '../runtime-services';
import { MarketDataOrchestrator } from './market-data-orchestrator';
import type { SidecarPriceRow } from './market-data-port';
import { createMarketDataServices } from './market-data-service';
import type { SyncQueue } from './sync-queue';

class MemorySecretStore {
    async get() {
        return null;
    }

    async set() {
        return undefined;
    }

    async delete() {
        return undefined;
    }
}

export const createInMemoryDataServices = () => {
    const assets: StoredAsset[] = [];
    const prices: DailyPriceRecord[] = [];
    const fxRates: FxRateRecord[] = [];
    const positions: Array<{
        assetId: string;
        costBasis: number;
        currency: string;
        id: string;
        portfolioName: string;
        shares: number;
    }> = [];
    const preferences = new Map<string, string>([
        [preferenceKeys.dataSource.akshareEnabled, 'true'],
        [preferenceKeys.dataSource.frankfurterEnabled, 'true'],
        [preferenceKeys.dataSource.yfinanceEnabled, 'true'],
    ]);

    const services = {
        close() {
            return undefined;
        },
        repositories: {
            assetRepository: {
                create(input: Omit<StoredAsset, 'createdAt' | 'updatedAt'>) {
                    const record: StoredAsset = {
                        ...input,
                        createdAt: '2026-01-01T00:00:00.000Z',
                        updatedAt: '2026-01-01T00:00:00.000Z',
                    };
                    assets.push(record);
                    return record;
                },
                list() {
                    return [...assets];
                },
                update(input: Omit<StoredAsset, 'createdAt' | 'updatedAt'>) {
                    const existingIndex = assets.findIndex((asset) => asset.id === input.id);
                    const existing = assets[existingIndex];
                    const record: StoredAsset = {
                        ...input,
                        createdAt: existing?.createdAt ?? '2026-01-01T00:00:00.000Z',
                        updatedAt: '2026-01-02T00:00:00.000Z',
                    };

                    if (existingIndex >= 0) {
                        assets[existingIndex] = record;
                        return record;
                    }

                    assets.push(record);
                    return record;
                },
            },
            fxRateRepository: {
                clearAll() {
                    fxRates.splice(0, fxRates.length);
                },
                count() {
                    return fxRates.length;
                },
                getDateBounds(pair: string) {
                    const rows = fxRates
                        .filter((row) => row.pair === pair)
                        .sort((left, right) => left.date.localeCompare(right.date));

                    return {
                        earliestDate: rows[0]?.date ?? null,
                        latestDate: rows.at(-1)?.date ?? null,
                    };
                },
                getLatestRate(pair: string, onOrBeforeDate: string) {
                    return (
                        [...fxRates]
                            .filter((row) => row.pair === pair && row.date <= onOrBeforeDate)
                            .sort((left, right) => right.date.localeCompare(left.date))[0] ?? null
                    );
                },
                getRange(pair: string, startDate: string, endDate: string) {
                    return [...fxRates]
                        .filter((row) => row.pair === pair && row.date >= startDate && row.date <= endDate)
                        .sort((left, right) => left.date.localeCompare(right.date));
                },
                insertMany(inputs: FxRateRecord[]) {
                    for (const input of inputs) {
                        const existingIndex = fxRates.findIndex(
                            (row) => row.pair === input.pair && row.date === input.date,
                        );

                        if (existingIndex >= 0) {
                            fxRates[existingIndex] = input;
                            continue;
                        }

                        fxRates.push(input);
                    }
                },
            },
            positionRepository: {
                save(input: {
                    assetId: string;
                    costBasis: number;
                    currency: string;
                    id: string;
                    portfolioName: string;
                    shares: number;
                }) {
                    positions.push(input);
                    return input;
                },
            },
            preferencesRepository: {
                delete(key: string) {
                    return preferences.delete(key);
                },
                get(key: string) {
                    return preferences.get(key) ?? null;
                },
                getAll() {
                    return Object.fromEntries(preferences.entries());
                },
                set(key: string, value: string) {
                    preferences.set(key, value);
                    return value;
                },
            },
            priceRepository: {
                clearAll() {
                    prices.splice(0, prices.length);
                },
                count() {
                    return prices.length;
                },
                getDateBounds(assetId: string) {
                    const assetPrices = prices
                        .filter((row) => row.assetId === assetId)
                        .sort((left, right) => left.date.localeCompare(right.date));

                    return {
                        earliestDate: assetPrices[0]?.date ?? null,
                        latestDate: assetPrices.at(-1)?.date ?? null,
                    };
                },
                getLatestFetchedAt() {
                    return [...prices]
                        .sort((left, right) => right.fetchedAt.localeCompare(left.fetchedAt))[0]?.fetchedAt ?? null;
                },
                getLatestFetchedAtByAssetId(assetId: string) {
                    return [...prices]
                        .filter((row) => row.assetId === assetId)
                        .sort((left, right) => right.fetchedAt.localeCompare(left.fetchedAt))[0]?.fetchedAt ?? null;
                },
                getRange({ assetId, startDate, endDate }: { assetId: string; startDate: string; endDate: string }) {
                    return [...prices]
                        .filter((row) => row.assetId === assetId && row.date >= startDate && row.date <= endDate)
                        .sort((left, right) => left.date.localeCompare(right.date));
                },
                insertMany(inputs: DailyPriceRecord[]) {
                    for (const input of inputs) {
                        const record: DailyPriceRecord = {
                            ...input,
                            fetchedAt: input.fetchedAt ?? new Date().toISOString(),
                        };
                        const existingIndex = prices.findIndex(
                            (row) => row.assetId === record.assetId && row.date === record.date,
                        );

                        if (existingIndex >= 0) {
                            prices[existingIndex] = record;
                            continue;
                        }

                        prices.push(record);
                    }
                },
                isFresh() {
                    return true;
                },
                listByAsset(assetId: string) {
                    return [...prices]
                        .filter((row) => row.assetId === assetId)
                        .sort((left, right) => left.date.localeCompare(right.date));
                },
            },
        },
        secretStore: new MemorySecretStore(),
    } as unknown as DataServices;

    return {
        assets,
        fxRates,
        positions,
        preferences,
        prices,
        services,
    };
};

export const createTestMarketDataOrchestrator = ({
    call,
    services,
    syncQueue,
}: {
    call?: (method: string, params?: unknown, options?: { timeoutMs?: number }) => Promise<unknown>;
    services: DataServices;
    syncQueue?: SyncQueue;
}) => new MarketDataOrchestrator(services, createMarketDataServices({
    dataServices: services,
    sidecarRuntime: {
        call: async <T>(method: string, params?: unknown, options?: { timeoutMs?: number }) => {
            if (!call) {
                throw new Error('Unexpected sidecar RPC call.');
            }

            return options === undefined
                ? await call(method, params) as T
                : await call(method, params, options) as T;
        },
    },
    syncQueue,
}));

export const pythonCommand = resolveSidecarPythonCommand({ isPackaged: false });
const sidecarSourcePath = path.resolve(process.cwd(), 'sidecar/src');
export const sidecarScriptPath = path.resolve(process.cwd(), 'sidecar/src/server.py');

export const createFailingProviderScript = async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'quantdesk-sidecar-failure-'));
    const scriptPath = path.join(tempDir, 'server_failure.py');

    await fs.writeFile(
        scriptPath,
        [
            'import asyncio',
            'import pathlib',
            'import sys',
            '',
            `sidecar_src = pathlib.Path(${JSON.stringify(sidecarSourcePath)})`,
            'sys.path.insert(0, str(sidecar_src))',
            '',
            'import server',
            '',
            'def failing_fetch_prices(*args, **kwargs):',
            '    raise RuntimeError("simulated provider failure")',
            '',
            'server.market_data_methods.yfinance.fetch_prices = failing_fetch_prices',
            'server.market_data_methods.akshare.fetch_prices = failing_fetch_prices',
            '',
            'if __name__ == "__main__":',
            '    asyncio.run(server.main())',
            '',
        ].join('\n'),
        'utf8',
    );

    return {
        async cleanup() {
            await fs.rm(tempDir, { force: true, recursive: true });
        },
        scriptPath,
    };
};

export const createFixtureProviderScript = async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'quantdesk-sidecar-fixture-'));
    const scriptPath = path.join(tempDir, 'server_fixture.py');

    await fs.writeFile(
        scriptPath,
        [
            'import asyncio',
            'import pathlib',
            'import sys',
            '',
            `sidecar_src = pathlib.Path(${JSON.stringify(sidecarSourcePath)})`,
            'sys.path.insert(0, str(sidecar_src))',
            '',
            'import server',
            '',
            'def fixture_yfinance_prices(symbol, start, end, market=None, asset_metadata=None):',
            '    return {',
            '        "symbol": symbol,',
            '        "prices": [',
            '            {',
            '                "adjusted_close": 585.0,',
            '                "close": 585.0,',
            '                "date": "2026-01-02",',
            '                "high": 586.0,',
            '                "low": 583.0,',
            '                "open": 584.0,',
            '                "source": "yfinance-test",',
            '                "volume": 117000000,',
            '            },',
            '            {',
            '                "adjusted_close": 589.0,',
            '                "close": 589.0,',
            '                "date": "2026-01-05",',
            '                "high": 590.0,',
            '                "low": 587.0,',
            '                "open": 588.0,',
            '                "source": "yfinance-test",',
            '                "volume": 116000000,',
            '            },',
            '        ],',
            '        "warnings": [],',
            '    }',
            '',
            'def fixture_akshare_prices(symbol, start, end, market=None, asset_metadata=None):',
            '    return {',
            '        "symbol": symbol,',
            '        "prices": [',
            '            {',
            '                "adjusted_close": 584.5,',
            '                "close": 584.5,',
            '                "date": "2026-01-02",',
            '                "high": 585.5,',
            '                "low": 582.5,',
            '                "open": 583.5,',
            '                "source": "akshare-test",',
            '                "volume": 98000000,',
            '            },',
            '            {',
            '                "adjusted_close": 588.5,',
            '                "close": 588.5,',
            '                "date": "2026-01-05",',
            '                "high": 589.5,',
            '                "low": 586.5,',
            '                "open": 587.5,',
            '                "source": "akshare-test",',
            '                "volume": 97000000,',
            '            },',
            '        ],',
            '        "warnings": [],',
            '    }',
            '',
            'server.market_data_methods.yfinance.fetch_prices = fixture_yfinance_prices',
            'server.market_data_methods.akshare.fetch_prices = fixture_akshare_prices',
            '',
            'if __name__ == "__main__":',
            '    asyncio.run(server.main())',
            '',
        ].join('\n'),
        'utf8',
    );

    return {
        async cleanup() {
            await fs.rm(tempDir, { force: true, recursive: true });
        },
        scriptPath,
    };
};

export const waitFor = async (predicate: () => boolean, timeoutMs = 8_000) => {
    const startedAt = Date.now();

    while (!predicate()) {
        if (Date.now() - startedAt > timeoutMs) {
            throw new Error(`Timed out after ${timeoutMs}ms waiting for condition.`);
        }

        await new Promise((resolve) => setTimeout(resolve, 100));
    }
};

export const buildMarketDataPriceRows = ({
    assetId,
    dates,
    source = 'akshare-nav',
}: {
    assetId: string;
    dates: string[];
    source?: string;
}): DailyPriceRecord[] =>
    dates.map((date, index) => ({
        adjustedClose: 100 + index,
        assetId,
        close: 100 + index,
        date,
        fetchedAt: '2026-01-12T00:00:00.000Z',
        high: null,
        low: null,
        open: null,
        source,
        volume: null,
    }));

export const toSidecarPriceRows = (rows: DailyPriceRecord[]): SidecarPriceRow[] =>
    rows.map((row) => ({
        adjusted_close: row.adjustedClose,
        close: row.close,
        date: row.date,
        high: row.high,
        low: row.low,
        open: row.open,
        source: row.source,
        volume: row.volume,
    }));