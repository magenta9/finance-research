import type { WindowSnapshot } from './types';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const rootMeanSquaredDistance = (left: number[], right: number[]) => {
    const length = Math.min(left.length, right.length);

    if (length === 0) {
        return Number.POSITIVE_INFINITY;
    }

    const sum = left.slice(0, length).reduce((total, value, index) => total + ((value - right[index]) ** 2), 0);

    return Math.sqrt(sum / length);
};

const normalizedDifference = (left: number, right: number, denominator: number) => (
    clamp(Math.abs(left - right) / denominator, 0, 1)
);

export const scoreAnalogWindow = (target: WindowSnapshot, analog: WindowSnapshot) => {
    const shapeDistance = rootMeanSquaredDistance(target.shapePath, analog.shapePath);
    const shapeScore = Number.isFinite(shapeDistance) ? 100 * Math.exp(-shapeDistance) : 0;
    const totalReturnDiff = Math.abs(target.totalReturn - analog.totalReturn);
    const maxDrawdownDiff = Math.abs(target.maxDrawdown - analog.maxDrawdown);
    const volatilityDiff = target.volatility != null && analog.volatility != null
        ? Math.abs(target.volatility - analog.volatility)
        : null;
    const returnPenalty = normalizedDifference(target.totalReturn, analog.totalReturn, 0.35);
    const volPenalty = target.volatility != null && analog.volatility != null
        ? normalizedDifference(target.volatility, analog.volatility, Math.max(target.volatility, 0.10))
        : 0.25;
    const drawdownPenalty = normalizedDifference(target.maxDrawdown, analog.maxDrawdown, 0.25);
    const penalty = 100 * ((0.20 * returnPenalty) + (0.15 * volPenalty) + (0.15 * drawdownPenalty));
    const score = clamp(shapeScore - penalty, 0, 100);

    return {
        maxDrawdownDiff,
        penalty,
        score,
        shapeDistance,
        shapeScore,
        totalReturnDiff,
        volatilityDiff,
    };
};

export const passesQualityGate = (score: ReturnType<typeof scoreAnalogWindow>) => (
    score.score >= 45 && score.shapeScore >= 50
);