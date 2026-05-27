import type { AllocationAssetWeight } from '@quantdesk/shared';

import type { PreparedAllocationData } from './preprocessor';

export interface AllocationRecordsInput {
    annualizedAssetVolatility: number[];
    annualizedMeanReturns: number[];
    effectiveWeights: number[];
    prepared: PreparedAllocationData;
    riskContributions: number[];
}

export interface AllocationRecords {
    allocations: AllocationAssetWeight[];
    weights: Record<string, number>;
}

export const buildAllocationRecords = ({
    annualizedAssetVolatility,
    annualizedMeanReturns,
    effectiveWeights,
    prepared,
    riskContributions,
}: AllocationRecordsInput): AllocationRecords => {
    const allocations = prepared.series.map((entry, index) => ({
        annualizedReturn: annualizedMeanReturns[index],
        annualizedVolatility: annualizedAssetVolatility[index],
        assetClass: entry.asset.assetClass,
        assetId: entry.asset.id,
        currency: entry.asset.currency,
        market: entry.asset.market,
        name: entry.asset.name,
        riskContribution: riskContributions[index],
        symbol: entry.asset.symbol,
        weight: effectiveWeights[index],
    })).sort((left, right) => right.weight - left.weight);

    return {
        allocations,
        weights: Object.fromEntries(
            prepared.series.map((entry, index) => [entry.asset.id, effectiveWeights[index]]),
        ),
    };
};
