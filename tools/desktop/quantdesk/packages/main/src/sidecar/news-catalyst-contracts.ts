import { readFileSync } from 'node:fs';

import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';

import type { NewsCatalystProviderId } from './market-data-port';
import { resolveContractsPath } from './market-data-contracts';

type NewsCatalystMarket = 'A' | 'HK' | 'US';
type NewsCatalystProviderStatus = 'disabled' | 'enabled' | 'planned';
type CatalystWindowStatus = boolean | 'unknown';

export interface NewsCatalystPolicy {
    announcementProviderOrder: Record<NewsCatalystMarket | 'default', NewsCatalystProviderId[]>;
    catalystCategories: string[];
    providerStatus: Record<NewsCatalystProviderId, NewsCatalystProviderStatus>;
    schemaVersion: 1;
    sourcePriorityWeights: Record<NewsCatalystProviderId, number>;
    symbolMarketRules: {
        rules: Array<{ description: string; id: string; market: NewsCatalystMarket | 'unknown' }>;
        unknownReasonCode: 'market_unresolved';
    };
    windowDefaults: {
        lookaheadDays: number;
        lookbackDays: number;
    };
}

export interface NewsCatalystMarketResolution {
    market: NewsCatalystMarket | null;
    reasonCode: 'market_unresolved' | null;
    symbol: string;
    warnings: string[];
}

export interface NewsCatalystWindowEvent {
    eventDate?: string | null;
    publishedAt?: string | null;
}

let policyCache: NewsCatalystPolicy | null = null;
let validatorCache: ValidateFunction<unknown> | null = null;

const ajv = new Ajv({ allErrors: true });
const marketSet = new Set(['A', 'HK', 'US']);

const readJsonFile = <T>(filePath: string) => JSON.parse(readFileSync(filePath, 'utf8')) as T;

const formatSchemaError = (error: ErrorObject) => {
    const pointer = error.instancePath || '$';

    if (error.keyword === 'required') {
        return `${pointer}.${(error.params as { missingProperty: string }).missingProperty} is required.`;
    }

    if (error.keyword === 'additionalProperties') {
        return `${pointer}.${(error.params as { additionalProperty: string }).additionalProperty} is not allowed.`;
    }

    return `${pointer} ${error.message ?? 'is invalid.'}.`;
};

const getValidator = () => {
    if (validatorCache) {
        return validatorCache;
    }

    try {
        validatorCache = ajv.compile(readJsonFile<Record<string, unknown>>(resolveContractsPath('news-catalyst-policy.schema.json')));
        return validatorCache;
    } catch (error) {
        throw new Error(
            `news-catalyst-policy.schema.json failed schema compilation:\n${error instanceof Error ? error.message : String(error)}`,
        );
    }
};

const normalizeMarket = (value: unknown): NewsCatalystMarket | null => (
    typeof value === 'string' && marketSet.has(value) ? value as NewsCatalystMarket : null
);

const normalizeSymbol = (symbol: string) => symbol.trim().toUpperCase();

const stripMarketSuffix = (symbol: string) => symbol.replace(/\.(SZ|SH|HK|US)$/u, '');

const parseDateOnly = (value: string | null | undefined) => {
    if (!value) {
        return null;
    }

    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/u);

    if (!match) {
        return null;
    }

    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
};

const formatDateOnly = (value: Date) => value.toISOString().slice(0, 10);

const addDays = (value: Date, days: number) => {
    const copy = new Date(value.getTime());
    copy.setUTCDate(copy.getUTCDate() + days);
    return copy;
};

const inRange = (value: Date | null, start: Date, end: Date) => (
    value !== null && value.getTime() >= start.getTime() && value.getTime() <= end.getTime()
);

export const resetNewsCatalystContractsCacheForTests = () => {
    policyCache = null;
    validatorCache = null;
};

export const loadNewsCatalystPolicy = () => {
    if (policyCache) {
        return policyCache;
    }

    const value = readJsonFile<unknown>(resolveContractsPath('news-catalyst-policy.json'));
    const validator = getValidator();

    if (!validator(value)) {
        const errors = validator.errors?.map(formatSchemaError) ?? ['$ is invalid.'];
        throw new Error(`news-catalyst-policy.json failed schema validation:\n${errors.join('\n')}`);
    }

    policyCache = value as NewsCatalystPolicy;
    return policyCache;
};

export const loadNewsCatalystFixture = <T>(fixtureName: string) => readJsonFile<T>(
    resolveContractsPath('market-data-fixtures', fixtureName),
);

export const resolveNewsCatalystSymbolMarket = ({
    assetMetadata,
    market,
    symbol,
}: {
    assetMetadata?: Record<string, unknown> | null;
    market?: string | null;
    symbol: string;
}): NewsCatalystMarketResolution => {
    const normalizedSymbol = normalizeSymbol(symbol);
    const explicitMarket = normalizeMarket(market);
    const metadataMarket = normalizeMarket(assetMetadata?.market);
    const resolvedContextMarket = explicitMarket ?? metadataMarket;

    if (resolvedContextMarket) {
        return {
            market: resolvedContextMarket,
            reasonCode: null,
            symbol: stripMarketSuffix(normalizedSymbol),
            warnings: [],
        };
    }

    if (/\.(SZ|SH)$/u.test(normalizedSymbol)) {
        return { market: 'A', reasonCode: null, symbol: stripMarketSuffix(normalizedSymbol), warnings: [] };
    }

    if (/\.HK$/u.test(normalizedSymbol) || /^\d{5}$/u.test(normalizedSymbol)) {
        return { market: 'HK', reasonCode: null, symbol: stripMarketSuffix(normalizedSymbol), warnings: [] };
    }

    if (/\.US$/u.test(normalizedSymbol) || /^[A-Z.]+$/u.test(normalizedSymbol)) {
        return { market: 'US', reasonCode: null, symbol: stripMarketSuffix(normalizedSymbol), warnings: [] };
    }

    return {
        market: null,
        reasonCode: 'market_unresolved',
        symbol: stripMarketSuffix(normalizedSymbol),
        warnings: [`Unable to resolve announcement market for ${symbol}; pass explicit market or asset metadata.`],
    };
};

export const getNewsCatalystProviderOrder = ({
    enabledProviders,
    market,
}: {
    enabledProviders?: NewsCatalystProviderId[];
    market?: string | null;
}) => {
    const policy = loadNewsCatalystPolicy();
    const marketKey = normalizeMarket(market) ?? 'default';
    const enabledSet = enabledProviders ? new Set(enabledProviders) : null;

    return policy.announcementProviderOrder[marketKey]
        .filter((providerId) => policy.providerStatus[providerId] === 'enabled')
        .filter((providerId) => enabledSet === null || enabledSet.has(providerId));
};

export const getNewsCatalystSourcePriority = (providerId: NewsCatalystProviderId) => (
    loadNewsCatalystPolicy().sourcePriorityWeights[providerId]
);

export const evaluateNewsCatalystWindow = ({
    events,
    lookaheadDays,
    lookbackDays,
    providerStatus,
    referenceDate,
}: {
    events: NewsCatalystWindowEvent[];
    lookaheadDays: number;
    lookbackDays: number;
    providerStatus: 'available' | 'degraded' | 'unavailable';
    referenceDate: string;
}): {
    inCatalystWindow: CatalystWindowStatus;
    window: {
        endDate: string;
        lookaheadDays: number;
        lookbackDays: number;
        referenceDate: string;
        startDate: string;
    };
} => {
    const reference = parseDateOnly(referenceDate) ?? parseDateOnly(new Date().toISOString())!;
    const start = addDays(reference, -lookbackDays);
    const end = addDays(reference, lookaheadDays);
    const window = {
        endDate: formatDateOnly(end),
        lookaheadDays,
        lookbackDays,
        referenceDate: formatDateOnly(reference),
        startDate: formatDateOnly(start),
    };

    if (providerStatus === 'unavailable') {
        return { inCatalystWindow: 'unknown', window };
    }

    const hasWindowEvent = events.some((event) => {
        const publishedAt = parseDateOnly(event.publishedAt);
        const eventDate = parseDateOnly(event.eventDate);

        if (inRange(publishedAt, start, reference)) {
            return true;
        }

        return publishedAt !== null
            && publishedAt.getTime() <= reference.getTime()
            && eventDate !== null
            && eventDate.getTime() > reference.getTime()
            && eventDate.getTime() <= end.getTime();
    });

    return { inCatalystWindow: hasWindowEvent, window };
};