import type { ResearchRequestInput, RiskProfileSnapshot } from '@quantdesk/shared';

const allowedCurrencies = new Set(['CNY', 'HKD', 'USD']);
const allowedRiskLevels = new Set(['low', 'medium', 'high', 'unknown']);

const maxQueryLength = 4_000;
const maxPortfolioNameLength = 120;
const maxAssetIds = 50;
const maxAssetIdLength = 128;
const maxSerializedRequestLength = 64 * 1024;

const isPlainObject = (value: unknown): value is Record<string, unknown> => (
    typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
);

const assertFiniteUnit = (value: unknown, fieldName: string) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error(`${fieldName} must be a finite number between 0 and 1.`);
    }

    return value;
};

export const validateRiskProfileSnapshot = (input: unknown): RiskProfileSnapshot => {
    if (!isPlainObject(input)) {
        throw new Error('Risk profile must be an object.');
    }

    if (typeof input.baseCurrency !== 'string' || !allowedCurrencies.has(input.baseCurrency)) {
        throw new Error('Risk profile baseCurrency is invalid.');
    }

    if (typeof input.riskTolerance !== 'string' || !allowedRiskLevels.has(input.riskTolerance)) {
        throw new Error('Risk profile riskTolerance is invalid.');
    }

    if (typeof input.updatedAt !== 'string' || Number.isNaN(Date.parse(input.updatedAt))) {
        throw new Error('Risk profile updatedAt is invalid.');
    }

    return {
        baseCurrency: input.baseCurrency as RiskProfileSnapshot['baseCurrency'],
        maxDrawdown: assertFiniteUnit(input.maxDrawdown, 'Risk profile maxDrawdown'),
        maxSingleWeight: assertFiniteUnit(input.maxSingleWeight, 'Risk profile maxSingleWeight'),
        riskTolerance: input.riskTolerance as RiskProfileSnapshot['riskTolerance'],
        singlePositionLossBudget: assertFiniteUnit(input.singlePositionLossBudget, 'Risk profile singlePositionLossBudget'),
        updatedAt: input.updatedAt,
    };
};

export const validateResearchRequestInput = (input: unknown): ResearchRequestInput => {
    if (!isPlainObject(input)) {
        throw new Error('Research request must be an object.');
    }

    const serialized = JSON.stringify(input);

    if (serialized.length > maxSerializedRequestLength) {
        throw new Error('Research request payload is too large.');
    }

    if (typeof input.query !== 'string') {
        throw new Error('Research request query is required.');
    }

    const query = input.query.trim();

    if (query.length === 0 || query.length > maxQueryLength) {
        throw new Error(`Research request query must be between 1 and ${maxQueryLength} characters.`);
    }

    let assetIds: string[] | undefined;

    if (input.assetIds !== undefined) {
        if (!Array.isArray(input.assetIds) || input.assetIds.length > maxAssetIds) {
            throw new Error(`Research request assetIds must contain at most ${maxAssetIds} entries.`);
        }

        assetIds = Array.from(new Set(input.assetIds.map((assetId) => {
            if (typeof assetId !== 'string') {
                throw new Error('Research request assetIds must be strings.');
            }

            const trimmedAssetId = assetId.trim();

            if (trimmedAssetId.length === 0 || trimmedAssetId.length > maxAssetIdLength) {
                throw new Error(`Research request assetIds must be between 1 and ${maxAssetIdLength} characters.`);
            }

            return trimmedAssetId;
        })));
    }

    let portfolioName: string | undefined;

    if (input.portfolioName !== undefined) {
        if (typeof input.portfolioName !== 'string') {
            throw new Error('Research request portfolioName must be a string.');
        }

        portfolioName = input.portfolioName.trim();

        if (portfolioName.length === 0 || portfolioName.length > maxPortfolioNameLength) {
            throw new Error(`Research request portfolioName must be between 1 and ${maxPortfolioNameLength} characters.`);
        }
    }

    return {
        ...(assetIds ? { assetIds } : {}),
        ...(portfolioName ? { portfolioName } : {}),
        query,
        riskProfile: input.riskProfile == null ? null : validateRiskProfileSnapshot(input.riskProfile),
    };
};