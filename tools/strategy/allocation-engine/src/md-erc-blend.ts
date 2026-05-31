/**
 * Convex blend of Most Diversified (MDP) and Equal Risk Contribution (ERC) weights.
 * See Choueifaty et al. (2013) MDP; Engle et al. ERC / risk parity literature.
 */
export const blendMdErcWeights = ({
    blendWeight,
    ercWeights,
    mdWeights,
}: {
    blendWeight: number;
    ercWeights: number[];
    mdWeights: number[];
}) => {
    const lambda = Math.min(1, Math.max(0, blendWeight));

    if (lambda <= 0 || ercWeights.length !== mdWeights.length) {
        return mdWeights;
    }

    const blended = mdWeights.map((weight, index) => (
        (1 - lambda) * weight + lambda * (ercWeights[index] ?? 0)
    ));
    const blendedTotal = blended.reduce((sum, weight) => sum + weight, 0);
    const mdTotal = mdWeights.reduce((sum, weight) => sum + weight, 0);

    if (blendedTotal <= 0 || mdTotal <= 0) {
        return mdWeights;
    }

    const scale = mdTotal / blendedTotal;

    return blended.map((weight) => weight * scale);
};
