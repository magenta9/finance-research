/**
 * Blend MDP weights toward cross-sectional momentum softmax prior (Faber / tactical allocation).
 */
const softmax = (scores: number[]) => {
    const maxScore = Math.max(...scores);
    const exponents = scores.map((score) => Math.exp(score - maxScore));
    const total = exponents.reduce((sum, value) => sum + value, 0);

    if (total <= 0) {
        return scores.map(() => 1 / scores.length);
    }

    return exponents.map((value) => value / total);
};

export const blendMomentumPriorWeights = ({
    blendWeight,
    mdWeights,
    momentumScores,
}: {
    blendWeight: number;
    mdWeights: number[];
    momentumScores: number[];
}) => {
    const lambda = Math.min(1, Math.max(0, blendWeight));

    if (lambda <= 0 || momentumScores.length !== mdWeights.length) {
        return mdWeights;
    }

    const prior = softmax(momentumScores);
    const blended = mdWeights.map((weight, index) => (
        (1 - lambda) * weight + lambda * (prior[index] ?? 0)
    ));
    const blendedTotal = blended.reduce((sum, weight) => sum + weight, 0);
    const mdTotal = mdWeights.reduce((sum, weight) => sum + weight, 0);

    if (blendedTotal <= 0 || mdTotal <= 0) {
        return mdWeights;
    }

    return blended.map((weight) => weight * (mdTotal / blendedTotal));
};
