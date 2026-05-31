/**
 * Nudge MDP weights toward higher diversification ratio (Choueifaty & Coignard 2008).
 * One-step blend toward volatility-weighted scores (DR gradient proxy).
 */
export const nudgeWeightsTowardDiversificationRatio = ({
    blendWeight,
    covariance,
    volatilities,
    weights,
}: {
    blendWeight: number;
    covariance: number[][];
    volatilities: number[];
    weights: number[];
}) => {
    const lambda = Math.min(1, Math.max(0, blendWeight));

    if (lambda <= 0) {
        return weights;
    }

    const marginalScores = weights.map((weight, index) => {
        let contribution = 0;

        for (let columnIndex = 0; columnIndex < weights.length; columnIndex += 1) {
            contribution += (covariance[index]?.[columnIndex] ?? 0) * (weights[columnIndex] ?? 0);
        }

        const volatility = Math.max(volatilities[index] ?? 0, 1e-12);

        return contribution / volatility;
    });
    const positiveTotal = marginalScores.reduce((sum, score) => sum + Math.max(score, 0), 0);
    const target = positiveTotal > 0
        ? marginalScores.map((score) => Math.max(score, 0) / positiveTotal)
        : weights.map(() => 1 / weights.length);
    const blended = weights.map((weight, index) => (
        (1 - lambda) * weight + lambda * (target[index] ?? 0)
    ));
    const blendedTotal = blended.reduce((sum, weight) => sum + weight, 0);
    const originalTotal = weights.reduce((sum, weight) => sum + weight, 0);

    if (blendedTotal <= 0 || originalTotal <= 0) {
        return weights;
    }

    return blended.map((weight) => weight * (originalTotal / blendedTotal));
};
