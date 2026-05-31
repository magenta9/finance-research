export const portfolioVolatilityAnnualized = (weights: number[], covariance: number[][]) => {
    let variance = 0;

    for (let rowIndex = 0; rowIndex < weights.length; rowIndex += 1) {
        for (let columnIndex = 0; columnIndex < weights.length; columnIndex += 1) {
            variance += weights[rowIndex] * weights[columnIndex] * (covariance[rowIndex]?.[columnIndex] ?? 0);
        }
    }

    return Math.sqrt(Math.max(variance, 0));
};

export const applyPortfolioVolatilityCap = ({
    capAnnualized,
    covariance,
    minRiskyScale,
    weights,
}: {
    capAnnualized: number;
    covariance: number[][];
    minRiskyScale: number;
    weights: number[];
}) => {
    const riskyTotal = weights.reduce((sum, weight) => sum + weight, 0);

    if (riskyTotal <= 0 || capAnnualized <= 0) {
        return { cashReserve: 0, weights };
    }

    const normalizedWeights = weights.map((weight) => weight / riskyTotal);
    const portfolioVolatility = portfolioVolatilityAnnualized(normalizedWeights, covariance);

    if (portfolioVolatility <= capAnnualized) {
        return { cashReserve: 0, weights };
    }

    const riskyScale = Math.max(minRiskyScale, capAnnualized / portfolioVolatility);
    const scaledWeights = weights.map((weight) => weight * riskyScale);
    const scaledRiskyTotal = scaledWeights.reduce((sum, weight) => sum + weight, 0);

    return {
        cashReserve: Math.max(0, 1 - scaledRiskyTotal),
        weights: scaledWeights,
    };
};
