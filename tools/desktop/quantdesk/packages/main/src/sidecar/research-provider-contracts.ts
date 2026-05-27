import { readFileSync } from 'node:fs';

import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';

import type { Market } from '@quantdesk/shared';

import { resolveContractsPath } from './market-data-contracts';
import type { ResearchProviderId } from './market-data-port';

type ResearchProviderMarket = 'A' | 'BOND' | 'COMMODITY' | 'HK' | 'US' | 'default';
type ResearchProviderStatus = 'disabled' | 'enabled' | 'planned';

export interface ResearchProviderPolicy {
    fieldCaveats: {
        northboundNetInflow: 'disclosure_policy_change_2024';
    };
    flowSentimentProviderOrder: Record<ResearchProviderMarket, ResearchProviderId[]>;
    freshness: {
        fundamentalsStaleAfterDays: number;
        providerPermissionBackoffHours: number;
    };
    fundamentalsProviderOrder: Record<ResearchProviderMarket, ResearchProviderId[]>;
    providerStatus: Record<ResearchProviderId, ResearchProviderStatus>;
    schemaVersion: 1;
}

let policyCache: ResearchProviderPolicy | null = null;
let validatorCache: ValidateFunction<unknown> | null = null;

const ajv = new Ajv({ allErrors: true });
const marketSet = new Set(['A', 'BOND', 'COMMODITY', 'HK', 'US']);

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
        validatorCache = ajv.compile(readJsonFile<Record<string, unknown>>(resolveContractsPath('research-provider-policy.schema.json')));
        return validatorCache;
    } catch (error) {
        throw new Error(
            `research-provider-policy.schema.json failed schema compilation:\n${error instanceof Error ? error.message : String(error)}`,
        );
    }
};

const normalizeMarket = (market?: Market | string | null): ResearchProviderMarket => (
    typeof market === 'string' && marketSet.has(market) ? market as ResearchProviderMarket : 'default'
);

const filterProviderOrder = (
    providerIds: ResearchProviderId[],
    enabledProviders: ResearchProviderId[] | undefined,
) => {
    const policy = loadResearchProviderPolicy();
    const enabledSet = enabledProviders ? new Set(enabledProviders) : null;

    return providerIds
        .filter((providerId) => policy.providerStatus[providerId] === 'enabled')
        .filter((providerId) => enabledSet === null || enabledSet.has(providerId));
};

export const resetResearchProviderContractsCacheForTests = () => {
    policyCache = null;
    validatorCache = null;
};

export const loadResearchProviderPolicy = () => {
    if (policyCache) {
        return policyCache;
    }

    const value = readJsonFile<unknown>(resolveContractsPath('research-provider-policy.json'));
    const validator = getValidator();

    if (!validator(value)) {
        const errors = validator.errors?.map(formatSchemaError) ?? ['$ is invalid.'];
        throw new Error(`research-provider-policy.json failed schema validation:\n${errors.join('\n')}`);
    }

    policyCache = value as ResearchProviderPolicy;
    return policyCache;
};

export const loadResearchProviderFixture = <T>(fixtureName: string) => readJsonFile<T>(
    resolveContractsPath('market-data-fixtures', fixtureName),
);

export const getFundamentalsProviderOrder = ({
    enabledProviders,
    market,
}: {
    enabledProviders?: ResearchProviderId[];
    market?: Market | string | null;
}) => {
    const policy = loadResearchProviderPolicy();
    return filterProviderOrder(policy.fundamentalsProviderOrder[normalizeMarket(market)], enabledProviders);
};

export const getFlowSentimentProviderOrder = ({
    enabledProviders,
    market,
}: {
    enabledProviders?: ResearchProviderId[];
    market?: Market | string | null;
}) => {
    const policy = loadResearchProviderPolicy();
    return filterProviderOrder(policy.flowSentimentProviderOrder[normalizeMarket(market)], enabledProviders);
};