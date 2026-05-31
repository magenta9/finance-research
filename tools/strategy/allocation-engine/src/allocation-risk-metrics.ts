import type { PreparedAllocationData } from './preprocessor';
import { computeRiskContributions, correlationMatrix } from './statistics';

export interface AllocationRiskMetricsInput {
    covariance: number[][];
    effectiveWeights: number[];
    prepared: PreparedAllocationData;
}

export interface AllocationRiskMetrics {
    contributions: number[];
    correlationMatrix: {
        labels: string[];
        matrix: number[][];
    };
    riskContributions: Record<string, number>;
}

export const buildAllocationRiskMetrics = ({
    covariance,
    effectiveWeights,
    prepared,
}: AllocationRiskMetricsInput): AllocationRiskMetrics => {
    const contributions = computeRiskContributions(effectiveWeights, covariance);

    return {
        contributions,
        correlationMatrix: {
            labels: prepared.series.map((entry) => entry.asset.symbol),
            matrix: correlationMatrix(covariance),
        },
        riskContributions: Object.fromEntries(
            prepared.series.map((entry, index) => [entry.asset.id, contributions[index]]),
        ),
    };
};
