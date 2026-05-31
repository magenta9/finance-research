/**
 * Flexible Asset Allocation (FAA) style cross-sectional momentum filter:
 * keep only top-N momentum names among momentum-eligible assets (Keller & Keuning).
 */
export const selectFaaMomentumTopIndices = ({
    eligibleIndices,
    momentumScores,
    topN,
}: {
    eligibleIndices: number[];
    momentumScores: number[];
    topN: number;
}) => {
    const boundedTopN = Math.max(1, Math.floor(topN));

    if (eligibleIndices.length <= boundedTopN) {
        return eligibleIndices;
    }

    return eligibleIndices
        .map((index) => ({
            index,
            score: momentumScores[index] ?? Number.NEGATIVE_INFINITY,
        }))
        .sort((left, right) => right.score - left.score)
        .slice(0, boundedTopN)
        .map((entry) => entry.index)
        .sort((left, right) => left - right);
};
