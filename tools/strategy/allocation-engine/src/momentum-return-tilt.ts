import { annualizationFactor } from './analytics-constants';

const normalizeWeights = (weights: number[]) => {
    const total = weights.reduce((sum, weight) => sum + weight, 0);

    if (total <= 0) {
        return weights.map(() => 1 / Math.max(weights.length, 1));
    }

    return weights.map((weight) => weight / total);
};

const zScores = (values: number[]) => {
    const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(values.length, 1);
    const standardDeviation = Math.sqrt(Math.max(variance, 1e-12));

    return values.map((value) => (value - mean) / standardDeviation);
};

const trackingErrorVolatility = ({
    covariance,
    referenceWeights,
    weights,
}: {
    covariance: number[][];
    referenceWeights: number[];
    weights: number[];
}) => {
    const activeWeights = referenceWeights.map((referenceWeight, index) => (
        (weights[index] ?? 0) - referenceWeight
    ));
    const variance = activeWeights.reduce((rowTotal, weight, rowIndex) => (
        rowTotal + weight * activeWeights.reduce((innerTotal, innerWeight, columnIndex) => (
            innerTotal + innerWeight * (covariance[rowIndex]?.[columnIndex] ?? 0)
        ), 0)
    ), 0);

    return Math.sqrt(Math.max(variance, 0) * annualizationFactor);
};

export const applyMomentumReturnTiltAroundWeights = ({
    covariance,
    momentumScores,
    referenceWeights,
    tiltStrength,
    trackingErrorVolatilityLimit,
}: {
    covariance: number[][];
    momentumScores: number[];
    referenceWeights: number[];
    tiltStrength: number;
    trackingErrorVolatilityLimit: number;
}) => {
    if (referenceWeights.length === 0 || tiltStrength <= 0 || trackingErrorVolatilityLimit <= 0) {
        return normalizeWeights(referenceWeights);
    }

    const tiltedRaw = normalizeWeights(referenceWeights.map((weight, index) => (
        weight * Math.exp(tiltStrength * (zScores(momentumScores)[index] ?? 0))
    )));
    const unconstrainedTrackingError = trackingErrorVolatility({
        covariance,
        referenceWeights,
        weights: tiltedRaw,
    });

    if (unconstrainedTrackingError <= trackingErrorVolatilityLimit) {
        return tiltedRaw;
    }

    const scale = trackingErrorVolatilityLimit / Math.max(unconstrainedTrackingError, 1e-12);

    return normalizeWeights(referenceWeights.map((weight, index) => (
        weight + scale * ((tiltedRaw[index] ?? 0) - weight)
    )));
};
