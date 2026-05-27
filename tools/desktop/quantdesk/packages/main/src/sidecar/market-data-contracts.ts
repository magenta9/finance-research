import { readFileSync } from 'node:fs';
import path from 'node:path';

import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';

import type { DataSourceId, Market } from '@quantdesk/shared';

import { resolveContractsRoot } from '../contracts/contracts-root';

type MarketPolicyKey = 'A' | 'BOND' | 'COMMODITY' | 'HK' | 'US' | 'default';
type PricePolicyKey = MarketPolicyKey | 'digitSymbolFallback';

type ProviderOrderMap<T extends string> = Record<T, DataSourceId[]>;
type PriceWeightMap = Record<MarketPolicyKey, Record<'akshare' | 'tushare' | 'yfinance', number>>;

export interface MarketDataPolicy {
    searchProviderOrder: ProviderOrderMap<MarketPolicyKey>;
    priceProviderOrder: ProviderOrderMap<PricePolicyKey>;
    fxProviderOrder: Array<'akshare' | 'frankfurter' | 'yfinance'>;
    sourcePriorityWeights: {
        price: PriceWeightMap;
        fx: Record<'akshare' | 'frankfurter' | 'yfinance', number>;
    };
    derivedSourcePenalty: number;
}

let contractsRootCache: string | null = null;

let marketDataPolicyCache: MarketDataPolicy | null = null;
let marketDataPolicyValidatorCache: ValidateFunction<unknown> | null = null;
let marketDataPolicyValidatorRootCache: string | null = null;

const ajv = new Ajv({ allErrors: true });

const getContractsRoot = () => {
    contractsRootCache ??= resolveContractsRoot({ startDir: __dirname });
    return contractsRootCache;
};

const readJsonFile = <T>(filePath: string) => JSON.parse(readFileSync(filePath, 'utf8')) as T;

const decodeJsonPointerSegment = (segment: string) => segment.replace(/~1/g, '/').replace(/~0/g, '~');

const formatInstancePath = (instancePath: string) => {
    if (instancePath.length === 0) {
        return '$';
    }

    return instancePath
        .split('/')
        .filter(Boolean)
        .map((segment) => decodeJsonPointerSegment(segment))
        .reduce((pointer, segment) => {
            if (/^\d+$/.test(segment)) {
                return `${pointer}[${segment}]`;
            }

            return `${pointer}.${segment}`;
        }, '$');
};

const formatEnumValue = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value);

const formatSchemaError = (error: ErrorObject) => {
    const pointer = formatInstancePath(error.instancePath);

    if (error.keyword === 'required') {
        return `${pointer}.${(error.params as { missingProperty: string }).missingProperty} is required.`;
    }

    if (error.keyword === 'additionalProperties') {
        return `${pointer}.${(error.params as { additionalProperty: string }).additionalProperty} is not allowed.`;
    }

    if (error.keyword === 'minItems') {
        return `${pointer} must contain at least ${(error.params as { limit: number }).limit} items.`;
    }

    if (error.keyword === 'enum' && Array.isArray(error.schema)) {
        return `${pointer} must be one of ${error.schema.map((value: unknown) => formatEnumValue(value)).join(', ')}.`;
    }

    if (error.keyword === 'type') {
        const expectedType = (error.params as { type: string }).type;
        const expectedLabel = expectedType === 'array'
            ? 'an array'
            : expectedType === 'object'
                ? 'an object'
                : `a ${expectedType}`;
        return `${pointer} must be ${expectedLabel}.`;
    }

    return `${pointer} ${error.message ?? 'is invalid.'}.`;
};

const getMarketDataPolicyValidator = () => {
    const contractsRoot = getContractsRoot();

    if (marketDataPolicyValidatorCache && marketDataPolicyValidatorRootCache === contractsRoot) {
        return marketDataPolicyValidatorCache;
    }

    const schemaFile = path.join(contractsRoot, 'market-data-policy.schema.json');

    try {
        marketDataPolicyValidatorCache = ajv.compile(readJsonFile<Record<string, unknown>>(schemaFile));
        marketDataPolicyValidatorRootCache = contractsRoot;
        return marketDataPolicyValidatorCache;
    } catch (error) {
        throw new Error(
            `market-data-policy.schema.json failed schema compilation:\n${error instanceof Error ? error.message : String(error)}`,
        );
    }
};

const assertSchemaValid = <T>(
    contractName: string,
    contractFile: string,
): T => {
    const validator = getMarketDataPolicyValidator();
    const value = readJsonFile<unknown>(contractFile);

    if (!validator(value)) {
        const errors = validator.errors?.map((error: ErrorObject) => formatSchemaError(error)) ?? ['$ is invalid.'];
        throw new Error(`${contractName} failed schema validation:\n${errors.join('\n')}`);
    }

    return value as T;
};

const normalizeMarketKey = (market?: string | null): MarketPolicyKey => {
    if (market == null || market === 'ALL') {
        return 'default';
    }

    if (market === 'A' || market === 'BOND' || market === 'COMMODITY' || market === 'HK' || market === 'US') {
        return market;
    }

    return 'default';
};

const filterOrderedSources = (
    providerIds: DataSourceId[],
    enabledSources: DataSourceId[] | undefined,
) => {
    if (!enabledSources || enabledSources.length === 0) {
        return providerIds;
    }

    const enabled = new Set(enabledSources);
    return providerIds.filter((providerId) => enabled.has(providerId));
};

export const resolveContractsPath = (...segments: string[]) => path.join(getContractsRoot(), ...segments);

export const resetMarketDataContractsCacheForTests = () => {
    contractsRootCache = null;
    marketDataPolicyCache = null;
    marketDataPolicyValidatorCache = null;
    marketDataPolicyValidatorRootCache = null;
};

export const loadMarketDataPolicy = () => {
    if (marketDataPolicyCache) {
        return marketDataPolicyCache;
    }

    marketDataPolicyCache = assertSchemaValid<MarketDataPolicy>(
        'market-data-policy.json',
        resolveContractsPath('market-data-policy.json'),
    );

    return marketDataPolicyCache;
};

export const loadMarketDataFixture = <T>(fixtureName: string) => {
    return readJsonFile<T>(resolveContractsPath('market-data-fixtures', fixtureName));
};

export const getSearchProviderOrder = ({
    enabledSources,
    market,
}: {
    enabledSources?: DataSourceId[];
    market?: Market | string | null;
}) => {
    const policy = loadMarketDataPolicy();
    return filterOrderedSources(policy.searchProviderOrder[normalizeMarketKey(market)], enabledSources);
};

export const getPriceProviderOrder = ({
    enabledSources,
    market,
    symbol,
}: {
    enabledSources?: DataSourceId[];
    market?: Market | string | null;
    symbol: string;
}) => {
    const policy = loadMarketDataPolicy();
    const key = normalizeMarketKey(market);
    const isDomesticFundSymbol = /^\d{6}$/.test(symbol);
    const orderedProviders = key === 'default' && isDomesticFundSymbol
        ? policy.priceProviderOrder.digitSymbolFallback
        : (key === 'BOND' || key === 'COMMODITY') && isDomesticFundSymbol
            ? policy.priceProviderOrder.A
        : policy.priceProviderOrder[key];

    return filterOrderedSources(orderedProviders, enabledSources);
};

export const getFxProviderOrder = (enabledSources?: DataSourceId[]) => {
    const policy = loadMarketDataPolicy();
    return filterOrderedSources(policy.fxProviderOrder, enabledSources);
};
