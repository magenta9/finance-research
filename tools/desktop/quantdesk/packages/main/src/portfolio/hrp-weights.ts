/**
 * Hierarchical Risk Parity (HRP) — López de Prado (2016), recursive bisection variant.
 */
import { correlationMatrix } from './statistics';

const MIN_VARIANCE = 1e-12;

const inverseVarianceWeights = (covariance: number[][], indices: number[]) => {
    const raw = indices.map((index) => 1 / Math.max(covariance[index]?.[index] ?? MIN_VARIANCE, MIN_VARIANCE));
    const total = raw.reduce((sum, value) => sum + value, 0);

    return raw.map((value) => value / total);
};

const clusterVariance = (covariance: number[][], indices: number[]) => {
    const weights = inverseVarianceWeights(covariance, indices);
    let variance = 0;

    for (let row = 0; row < indices.length; row += 1) {
        for (let column = 0; column < indices.length; column += 1) {
            variance += weights[row] * weights[column]
                * (covariance[indices[row]]?.[indices[column]] ?? 0);
        }
    }

    return Math.max(variance, MIN_VARIANCE);
};

const quasiDiagonalOrder = (covariance: number[][]) => {
    const assetCount = covariance.length;
    const correlations = correlationMatrix(covariance);
    const remaining = Array.from({ length: assetCount }, (_, index) => index);
    const ordered: number[] = [];

    while (remaining.length > 0) {
        if (remaining.length === 1) {
            ordered.push(remaining[0]);
            break;
        }

        let bestIndex = 0;
        let bestDistance = Infinity;

        for (let index = 0; index < remaining.length; index += 1) {
            const assetIndex = remaining[index];
            const averageDistance = remaining.reduce((sum, otherIndex) => {
                if (otherIndex === assetIndex) {
                    return sum;
                }

                const correlation = correlations[assetIndex]?.[otherIndex] ?? 0;
                return sum + Math.sqrt(0.5 * (1 - correlation));
            }, 0) / Math.max(1, remaining.length - 1);

            if (averageDistance < bestDistance) {
                bestDistance = averageDistance;
                bestIndex = index;
            }
        }

        ordered.push(remaining[bestIndex]);
        remaining.splice(bestIndex, 1);
    }

    return ordered;
};

const recursiveBisection = (
    covariance: number[][],
    orderedIndices: number[],
    weights: number[],
    weightBudget: number,
) => {
    if (orderedIndices.length === 1) {
        weights[orderedIndices[0]] += weightBudget;
        return;
    }

    const midpoint = Math.ceil(orderedIndices.length / 2);
    const left = orderedIndices.slice(0, midpoint);
    const right = orderedIndices.slice(midpoint);
    const leftVariance = clusterVariance(covariance, left);
    const rightVariance = clusterVariance(covariance, right);
    const leftBudget = weightBudget * (1 - leftVariance / (leftVariance + rightVariance));
    const rightBudget = weightBudget - leftBudget;
    const leftWeights = inverseVarianceWeights(covariance, left);
    const rightWeights = inverseVarianceWeights(covariance, right);

    left.forEach((index, position) => {
        weights[index] += leftBudget * (leftWeights[position] ?? 0);
    });
    right.forEach((index, position) => {
        weights[index] += rightBudget * (rightWeights[position] ?? 0);
    });
};

export const computeHrpWeights = (covariance: number[][]) => {
    const assetCount = covariance.length;

    if (assetCount === 0) {
        return [];
    }

    if (assetCount === 1) {
        return [1];
    }

    const ordered = quasiDiagonalOrder(covariance);
    const weights = Array.from({ length: assetCount }, () => 0);
    recursiveBisection(covariance, ordered, weights, 1);
    const total = weights.reduce((sum, weight) => sum + weight, 0);

    if (total <= 0) {
        return Array.from({ length: assetCount }, () => 1 / assetCount);
    }

    return weights.map((weight) => weight / total);
};

export const blendMdHrpWeights = ({
    blendWeight,
    hrpWeights,
    mdWeights,
}: {
    blendWeight: number;
    hrpWeights: number[];
    mdWeights: number[];
}) => {
    const lambda = Math.min(1, Math.max(0, blendWeight));

    if (lambda <= 0 || hrpWeights.length !== mdWeights.length) {
        return mdWeights;
    }

    const blended = mdWeights.map((weight, index) => (
        (1 - lambda) * weight + lambda * (hrpWeights[index] ?? 0)
    ));
    const blendedTotal = blended.reduce((sum, weight) => sum + weight, 0);
    const mdTotal = mdWeights.reduce((sum, weight) => sum + weight, 0);

    if (blendedTotal <= 0 || mdTotal <= 0) {
        return mdWeights;
    }

    return blended.map((weight) => weight * (mdTotal / blendedTotal));
};
