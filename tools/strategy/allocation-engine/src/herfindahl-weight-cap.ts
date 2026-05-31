const WEIGHT_EPSILON = 1e-12;

const herfindahlIndex = (normalizedWeights: number[]) => (
    normalizedWeights.reduce((sum, weight) => sum + weight ** 2, 0)
);

/**
 * Cap portfolio concentration via Herfindahl index (CFA Institute / risk budgeting).
 * Default max HHI: 0.22 (~5 equal-weight names).
 */
export const applyHerfindahlWeightCap = ({
    maxHerfindahl = 0.22,
    weights,
}: {
    maxHerfindahl?: number;
    weights: number[];
}) => {
    const originalTotal = weights.reduce((sum, weight) => sum + weight, 0);

    if (originalTotal <= WEIGHT_EPSILON || maxHerfindahl <= 0) {
        return weights;
    }

    const normalized = weights.map((weight) => weight / originalTotal);

    if (herfindahlIndex(normalized) <= maxHerfindahl) {
        return weights;
    }

    const activeCount = normalized.filter((weight) => weight > WEIGHT_EPSILON).length;

    if (activeCount === 0) {
        return weights;
    }

    const minAchievableHerfindahl = 1 / activeCount;

    if (minAchievableHerfindahl > maxHerfindahl) {
        const equalWeight = originalTotal / activeCount;

        return weights.map((weight) => (weight > WEIGHT_EPSILON ? equalWeight : 0));
    }

    const equalWeight = 1 / activeCount;
    const equalWeights = normalized.map((weight) => (weight > WEIGHT_EPSILON ? equalWeight : 0));
    let lower = 0;
    let upper = 1;
    let blended = normalized;

    for (let iteration = 0; iteration < 32; iteration += 1) {
        const lambda = (lower + upper) / 2;
        const candidate = normalized.map((weight, index) => (
            (1 - lambda) * weight + lambda * (equalWeights[index] ?? 0)
        ));
        const candidateTotal = candidate.reduce((sum, weight) => sum + weight, 0);
        const candidateNormalized = candidate.map((weight) => weight / candidateTotal);

        if (herfindahlIndex(candidateNormalized) > maxHerfindahl) {
            lower = lambda;
        } else {
            upper = lambda;
            blended = candidateNormalized;
        }
    }

    return blended.map((weight) => weight * originalTotal);
};
