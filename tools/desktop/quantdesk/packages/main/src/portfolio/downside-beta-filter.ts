import { correlationMatrix } from './statistics';

const WEIGHT_EPSILON = 1e-12;

/**
 * Drop assets with high downside beta vs equal-weighted market proxy (Bollerslev et al.).
 * Default threshold: 1.25.
 */
export const filterIndicesByDownsideBeta = ({
    covariance,
    indices,
    threshold = 1.25,
}: {
    covariance: number[][];
    indices: number[];
    threshold?: number;
}) => {
    if (indices.length <= 1) {
        return indices;
    }

    const correlations = correlationMatrix(covariance);
    const subset = indices.map((index) => ({
        index,
        variance: Math.max(covariance[index]?.[index] ?? 0, WEIGHT_EPSILON),
    }));
    const equalWeight = 1 / subset.length;
    let marketVariance = 0;

    subset.forEach((left) => {
        subset.forEach((right) => {
            marketVariance += equalWeight * equalWeight
                * (covariance[left.index]?.[right.index] ?? 0);
        });
    });

    marketVariance = Math.max(marketVariance, WEIGHT_EPSILON);
    const marketVolatility = Math.sqrt(marketVariance);

    const filtered = subset.filter(({ index, variance }) => {
        const assetVolatility = Math.sqrt(variance);
        const correlation = subset.reduce((sum, other) => (
            sum + equalWeight * (correlations[index]?.[other.index] ?? 0)
        ), 0);
        const downsideBeta = assetVolatility > 0
            ? correlation * marketVolatility / assetVolatility
            : 0;

        return downsideBeta <= threshold;
    });

    if (filtered.length === 0) {
        return indices;
    }

    return filtered.map((entry) => entry.index);
};
