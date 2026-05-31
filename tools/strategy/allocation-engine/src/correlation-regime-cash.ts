import { correlationMatrix } from './statistics';

const boundedCashReserve = (value: number) => Math.min(0.95, Math.max(0, value));

/**
 * Raise cash when average pairwise correlation is elevated (Ang & Bekaert regime intuition).
 * scale=1 applies up to +15% cash when mean off-diagonal rho exceeds 0.45.
 */
export const applyCorrelationRegimeCashScale = ({
    baseCashReserve,
    covariance,
    scale,
}: {
    baseCashReserve: number;
    covariance: number[][];
    scale: number;
}) => {
    if (scale <= 0 || covariance.length < 2) {
        return baseCashReserve;
    }

    const correlations = correlationMatrix(covariance);
    let correlationSum = 0;
    let pairCount = 0;

    for (let rowIndex = 0; rowIndex < correlations.length; rowIndex += 1) {
        for (let columnIndex = rowIndex + 1; columnIndex < correlations.length; columnIndex += 1) {
            correlationSum += correlations[rowIndex]?.[columnIndex] ?? 0;
            pairCount += 1;
        }
    }

    if (pairCount === 0) {
        return baseCashReserve;
    }

    const averageCorrelation = correlationSum / pairCount;
    const regimeThreshold = 0.45;
    const maxBoost = 0.15;

    if (averageCorrelation <= regimeThreshold) {
        return baseCashReserve;
    }

    const intensity = Math.min(1, (averageCorrelation - regimeThreshold) / (1 - regimeThreshold));

    return boundedCashReserve(baseCashReserve + scale * intensity * maxBoost);
};
