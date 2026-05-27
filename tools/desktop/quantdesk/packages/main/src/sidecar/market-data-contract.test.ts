import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

import {
    getFxProviderOrder,
    getPriceProviderOrder,
    getSearchProviderOrder,
    loadMarketDataFixture,
    loadMarketDataPolicy,
    resetMarketDataContractsCacheForTests,
    resolveContractsPath,
} from './market-data-contracts';
import { getSourcePriority } from './provider-config';

const originalResourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
const originalContractsRoot = process.env.QUANTDESK_CONTRACTS_ROOT;
const workspaceContractsRoot = path.resolve(__dirname, '../../../../contracts');
const tempDirectories: string[] = [];

const createTempContractsRoot = (mutatePolicy: (policy: Record<string, unknown>) => void) => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'quantdesk-contracts-'));
    const contractsRoot = path.join(tempDir, 'contracts');
    const policyPath = path.join(contractsRoot, 'market-data-policy.json');

    tempDirectories.push(tempDir);
    cpSync(workspaceContractsRoot, contractsRoot, { recursive: true });

    const policy = JSON.parse(readFileSync(policyPath, 'utf8')) as Record<string, unknown>;
    mutatePolicy(policy);
    writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`);

    return contractsRoot;
};

afterEach(() => {
    vi.restoreAllMocks();
    resetMarketDataContractsCacheForTests();

    for (const tempDir of tempDirectories.splice(0)) {
        rmSync(tempDir, { force: true, recursive: true });
    }

    if (originalContractsRoot === undefined) {
        Reflect.deleteProperty(process.env, 'QUANTDESK_CONTRACTS_ROOT');
    } else {
        process.env.QUANTDESK_CONTRACTS_ROOT = originalContractsRoot;
    }

    if (originalResourcesPath === undefined) {
        Reflect.deleteProperty(process as NodeJS.Process & { resourcesPath?: string }, 'resourcesPath');
        return;
    }

    Object.defineProperty(process, 'resourcesPath', {
        configurable: true,
        value: originalResourcesPath,
        writable: true,
    });
});

describe('market data contracts', () => {
    test('loads the shared market data policy artifact', () => {
        const policy = loadMarketDataPolicy();

        expect(policy.searchProviderOrder.US).toEqual(['yfinance']);
        expect(policy.searchProviderOrder.HK).toEqual(['yfinance']);
        expect(policy.searchProviderOrder.COMMODITY).toEqual(['tushare', 'akshare']);
        expect(policy.priceProviderOrder.A).toEqual(['tushare', 'akshare']);
        expect(policy.priceProviderOrder.HK).toEqual(['akshare', 'yfinance']);
        expect(policy.priceProviderOrder.COMMODITY).toEqual(['tushare', 'akshare']);
        expect(policy.fxProviderOrder).toEqual(['akshare', 'yfinance', 'frankfurter']);
    });

    test('keeps provider routing aligned with the shared fixture corpus', () => {
        const fixture = loadMarketDataFixture<{
            cases: Array<{
                enabledSources: Array<'akshare' | 'frankfurter' | 'tushare' | 'yfinance'>;
                expectedProviders: string[];
                kind: 'fx' | 'price' | 'search';
                market: string | null;
                name: string;
                symbol: string;
            }>;
        }>('provider-routing.json');

        for (const testCase of fixture.cases) {
            const actual = testCase.kind === 'search'
                ? getSearchProviderOrder({
                    enabledSources: testCase.enabledSources,
                    market: testCase.market,
                })
                : testCase.kind === 'price'
                    ? getPriceProviderOrder({
                        enabledSources: testCase.enabledSources,
                        market: testCase.market,
                        symbol: testCase.symbol,
                    })
                    : getFxProviderOrder(testCase.enabledSources);

            expect(actual, testCase.name).toEqual(testCase.expectedProviders);
        }
    });

    test('keeps source priority aligned with the shared fixture corpus', () => {
        const fixture = loadMarketDataFixture<{
            cases: Array<{
                expectedPriority: number;
                kind: 'fx' | 'price';
                market: string | null;
                name: string;
                source: string;
            }>;
        }>('provider-priority.json');

        for (const testCase of fixture.cases) {
            const actual = getSourcePriority({
                kind: testCase.kind,
                market: testCase.market,
                source: testCase.source,
            });

            expect(actual, testCase.name).toBe(testCase.expectedPriority);
        }
    });

    test('prefers workspace contracts when Electron resourcesPath is missing them in development', () => {
        vi.spyOn(process, 'cwd').mockReturnValue(path.resolve(__dirname, '../../../../'));
        Object.defineProperty(process, 'resourcesPath', {
            configurable: true,
            value: '/tmp/quantdesk-missing-electron-resources',
            writable: true,
        });
        resetMarketDataContractsCacheForTests();

        expect(resolveContractsPath('market-data-policy.json')).toBe(
            path.resolve(__dirname, '../../../../contracts/market-data-policy.json'),
        );
        expect(loadMarketDataPolicy().priceProviderOrder.A).toEqual(['tushare', 'akshare']);
    });

    test('rejects invalid market data policy artifacts loaded from an overridden contracts root', () => {
        const contractsRoot = createTempContractsRoot((policy) => {
            const searchProviderOrder = policy.searchProviderOrder as Record<string, unknown>;
            Reflect.deleteProperty(searchProviderOrder, 'default');
        });

        process.env.QUANTDESK_CONTRACTS_ROOT = contractsRoot;
        resetMarketDataContractsCacheForTests();

        let thrown: unknown;

        try {
            loadMarketDataPolicy();
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(Error);
        expect((thrown as Error).message).toContain('searchProviderOrder.default');
        expect((thrown as Error).message).toContain('required');
    });
});