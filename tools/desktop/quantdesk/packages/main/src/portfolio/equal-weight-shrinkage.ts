const WEIGHT_EPSILON = 1e-12;

export const applyEqualWeightShrinkage = ({
    intensity,
    weights,
}: {
    intensity: number;
    weights: number[];
}) => {
    if (intensity <= 0) {
        return weights;
    }

    const lambda = Math.min(1, intensity);
    const activeIndices = weights
        .map((weight, index) => (weight > WEIGHT_EPSILON ? index : -1))
        .filter((index) => index >= 0);

    if (activeIndices.length === 0) {
        return weights;
    }

    const equalWeight = 1 / activeIndices.length;
    const blended = weights.map((weight, index) => {
        if (weight <= WEIGHT_EPSILON) {
            return 0;
        }

        return (1 - lambda) * weight + lambda * equalWeight;
    });
    const blendedTotal = blended.reduce((sum, weight) => sum + weight, 0);
    const originalTotal = weights.reduce((sum, weight) => sum + weight, 0);

    if (blendedTotal <= WEIGHT_EPSILON || originalTotal <= WEIGHT_EPSILON) {
        return weights;
    }

    const scale = originalTotal / blendedTotal;

    return blended.map((weight) => weight * scale);
};
