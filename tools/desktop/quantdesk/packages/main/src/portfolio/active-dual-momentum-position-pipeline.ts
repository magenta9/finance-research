import type {
    ActiveDualMomentumCashBreakdown,
    ActiveDualMomentumProcessorTrace,
} from '@quantdesk/shared';

import type { PreparedAllocationData } from './preprocessor';
import {
    signedActiveDualMomentumWeight,
    type ActiveDualMomentumPosition,
    type NormalizedActiveDualMomentumConfig,
} from './active-dual-momentum-rules';

const minimumPositionWeight = 0.000001;

type PositionProcessorId = ActiveDualMomentumProcessorTrace['id'];

interface PositionProcessorOutcome {
    cashWeight: number;
    positions: ActiveDualMomentumPosition[];
}

export interface ActiveDualMomentumPositionPipelineCashInputs {
    sameAssetSleeveDedup: number;
    sleeveFilter: number;
    standingBuffer: number;
}

export interface ActiveDualMomentumPositionPipelineInput {
    assetCount: number;
    baseTargetPositions: ActiveDualMomentumPosition[];
    cashInputs: ActiveDualMomentumPositionPipelineCashInputs;
    config: NormalizedActiveDualMomentumConfig;
    maxLookbackDays: number;
    prepared: PreparedAllocationData;
    previousPositions: ActiveDualMomentumPosition[];
    rebalanceIndex: number;
}

export interface ActiveDualMomentumPositionPipelineResult {
    cashBreakdown: ActiveDualMomentumCashBreakdown;
    explicitCashWeight: number;
    processorTrace: ActiveDualMomentumProcessorTrace[];
    residualCashWeight: number;
    resolvedCashWeight: number;
    targetPositions: ActiveDualMomentumPosition[];
}

const grossWeight = (positions: ActiveDualMomentumPosition[]) =>
    positions.reduce((sum, position) => sum + position.weight, 0);

const positionsByAssetIndex = (positions: ActiveDualMomentumPosition[]) => new Map(positions.map((position) => [position.assetIndex, position]));

const changedPositionCount = (previousPositions: ActiveDualMomentumPosition[], nextPositions: ActiveDualMomentumPosition[], assetCount: number) => {
    const previousByAssetIndex = positionsByAssetIndex(previousPositions);
    const nextByAssetIndex = positionsByAssetIndex(nextPositions);
    let count = 0;

    for (let assetIndex = 0; assetIndex < assetCount; assetIndex += 1) {
        const previous = previousByAssetIndex.get(assetIndex);
        const next = nextByAssetIndex.get(assetIndex);
        const previousSigned = previous ? signedActiveDualMomentumWeight(previous) : 0;
        const nextSigned = next ? signedActiveDualMomentumWeight(next) : 0;

        if (Math.abs(previousSigned - nextSigned) >= minimumPositionWeight) {
            count += 1;
        }
    }

    return count;
};

const traceProcessor = ({
    assetCount,
    cashWeight,
    id,
    inputPositions,
    outputPositions,
}: {
    assetCount: number;
    cashWeight: number;
    id: PositionProcessorId;
    inputPositions: ActiveDualMomentumPosition[];
    outputPositions: ActiveDualMomentumPosition[];
}): ActiveDualMomentumProcessorTrace => ({
    cashWeight,
    changedPositionCount: changedPositionCount(inputPositions, outputPositions, assetCount),
    id,
    inputGrossWeight: grossWeight(inputPositions),
    outputGrossWeight: grossWeight(outputPositions),
});

const applyRiskExitRedeploymentCooldown = ({
    assetCount,
    previousPositions,
    targetPositions,
}: {
    assetCount: number;
    previousPositions: ActiveDualMomentumPosition[];
    targetPositions: ActiveDualMomentumPosition[];
}): PositionProcessorOutcome => {
    const previousByAssetIndex = positionsByAssetIndex(previousPositions);
    const targetByAssetIndex = positionsByAssetIndex(targetPositions);
    let exitWeight = 0;
    let increaseWeight = 0;

    for (let assetIndex = 0; assetIndex < assetCount; assetIndex += 1) {
        const previous = previousByAssetIndex.get(assetIndex);
        const target = targetByAssetIndex.get(assetIndex);
        const previousSigned = previous ? signedActiveDualMomentumWeight(previous) : 0;
        const targetSigned = target ? signedActiveDualMomentumWeight(target) : 0;

        if (previous && (!target || Math.sign(previousSigned) !== Math.sign(targetSigned))) {
            exitWeight += previous.weight;
        }
        if (target) {
            increaseWeight += Math.sign(previousSigned) === Math.sign(targetSigned)
                ? Math.max(0, target.weight - Math.abs(previousSigned))
                : target.weight;
        }
    }

    const cooldownWeight = Math.min(exitWeight, increaseWeight);
    if (cooldownWeight <= 0 || increaseWeight <= 0) {
        return { cashWeight: 0, positions: targetPositions };
    }

    const retainedIncreaseRatio = (increaseWeight - cooldownWeight) / increaseWeight;
    const positions = targetPositions.flatMap((target) => {
        const previous = previousByAssetIndex.get(target.assetIndex);
        const previousSigned = previous ? signedActiveDualMomentumWeight(previous) : 0;
        const targetSigned = signedActiveDualMomentumWeight(target);
        const retainedBaseWeight = Math.sign(previousSigned) === Math.sign(targetSigned)
            ? Math.min(Math.abs(previousSigned), target.weight)
            : 0;
        const increase = target.weight - retainedBaseWeight;
        const weight = retainedBaseWeight + increase * retainedIncreaseRatio;

        return weight >= minimumPositionWeight ? [{ ...target, weight }] : [];
    });

    return { cashWeight: cooldownWeight, positions };
};

const applyRiskTrimRedeploymentCooldown = ({
    assetCount,
    previousPositions,
    targetPositions,
}: {
    assetCount: number;
    previousPositions: ActiveDualMomentumPosition[];
    targetPositions: ActiveDualMomentumPosition[];
}): PositionProcessorOutcome => {
    const previousByAssetIndex = positionsByAssetIndex(previousPositions);
    const targetByAssetIndex = positionsByAssetIndex(targetPositions);
    let trimmedWeight = 0;
    let increaseWeight = 0;

    for (let assetIndex = 0; assetIndex < assetCount; assetIndex += 1) {
        const previous = previousByAssetIndex.get(assetIndex);
        const target = targetByAssetIndex.get(assetIndex);
        const previousSigned = previous ? signedActiveDualMomentumWeight(previous) : 0;
        const targetSigned = target ? signedActiveDualMomentumWeight(target) : 0;

        if (previous && target && Math.sign(previousSigned) === Math.sign(targetSigned) && target.weight < previous.weight) {
            trimmedWeight += previous.weight - target.weight;
        }
        if (target) {
            increaseWeight += Math.sign(previousSigned) === Math.sign(targetSigned)
                ? Math.max(0, target.weight - Math.abs(previousSigned))
                : target.weight;
        }
    }

    const cooldownWeight = Math.min(trimmedWeight, increaseWeight);
    if (cooldownWeight <= 0 || increaseWeight <= 0) {
        return { cashWeight: 0, positions: targetPositions };
    }

    const retainedIncreaseRatio = (increaseWeight - cooldownWeight) / increaseWeight;
    const positions = targetPositions.flatMap((target) => {
        const previous = previousByAssetIndex.get(target.assetIndex);
        const previousSigned = previous ? signedActiveDualMomentumWeight(previous) : 0;
        const targetSigned = signedActiveDualMomentumWeight(target);
        const retainedBaseWeight = Math.sign(previousSigned) === Math.sign(targetSigned)
            ? Math.min(Math.abs(previousSigned), target.weight)
            : 0;
        const increase = target.weight - retainedBaseWeight;
        const weight = retainedBaseWeight + increase * retainedIncreaseRatio;

        return weight >= minimumPositionWeight ? [{ ...target, weight }] : [];
    });

    return { cashWeight: cooldownWeight, positions };
};

const applyCrossSignOffsetCash = (positions: ActiveDualMomentumPosition[]): PositionProcessorOutcome => {
    const longGross = positions
        .filter((position) => position.direction === 'long')
        .reduce((sum, position) => sum + position.weight, 0);
    const shortGross = positions
        .filter((position) => position.direction === 'short')
        .reduce((sum, position) => sum + position.weight, 0);
    const offsetWeight = Math.min(longGross, shortGross);

    if (offsetWeight <= 0 || longGross <= 0 || shortGross <= 0) {
        return { cashWeight: 0, positions };
    }

    const longRetainedRatio = (longGross - offsetWeight) / longGross;
    const shortRetainedRatio = (shortGross - offsetWeight) / shortGross;
    const compressedPositions = positions.flatMap((position) => {
        const retainedRatio = position.direction === 'long' ? longRetainedRatio : shortRetainedRatio;
        const weight = position.weight * retainedRatio;

        return weight >= minimumPositionWeight ? [{ ...position, weight }] : [];
    });

    return { cashWeight: offsetWeight * 2, positions: compressedPositions };
};

const returnCorrelation = (leftReturns: number[], rightReturns: number[]) => {
    const count = Math.min(leftReturns.length, rightReturns.length);

    if (count < 2) {
        return 0;
    }

    const left = leftReturns.slice(-count);
    const right = rightReturns.slice(-count);
    const leftMean = left.reduce((sum, value) => sum + value, 0) / count;
    const rightMean = right.reduce((sum, value) => sum + value, 0) / count;
    let covariance = 0;
    let leftVariance = 0;
    let rightVariance = 0;

    for (let index = 0; index < count; index += 1) {
        const leftDiff = left[index] - leftMean;
        const rightDiff = right[index] - rightMean;
        covariance += leftDiff * rightDiff;
        leftVariance += leftDiff ** 2;
        rightVariance += rightDiff ** 2;
    }

    return leftVariance > 0 && rightVariance > 0
        ? covariance / Math.sqrt(leftVariance * rightVariance)
        : 0;
};

const selectedDailyReturns = ({
    endIndex,
    prepared,
    startIndex,
}: {
    endIndex: number;
    prepared: PreparedAllocationData;
    startIndex: number;
}) => prepared.series.map((entry) => {
    const returns: number[] = [];

    for (let index = Math.max(1, startIndex + 1); index <= endIndex; index += 1) {
        const previousPrice = entry.prices[index - 1] ?? 0;
        const currentPrice = entry.prices[index] ?? 0;

        if (previousPrice > 0 && currentPrice > 0) {
            returns.push(currentPrice / previousPrice - 1);
        }
    }

    return returns;
});

const connectedCorrelationClusters = ({
    correlationThreshold,
    positions,
    returnsByAsset,
}: {
    correlationThreshold: number;
    positions: ActiveDualMomentumPosition[];
    returnsByAsset: number[][];
}) => {
    const visited = new Set<number>();
    const clusters: number[][] = [];

    for (let startIndex = 0; startIndex < positions.length; startIndex += 1) {
        if (visited.has(startIndex)) {
            continue;
        }

        const cluster: number[] = [];
        const stack = [startIndex];
        visited.add(startIndex);

        while (stack.length > 0) {
            const currentIndex = stack.pop() ?? startIndex;
            cluster.push(currentIndex);

            for (let nextIndex = 0; nextIndex < positions.length; nextIndex += 1) {
                if (visited.has(nextIndex)) {
                    continue;
                }

                const current = positions[currentIndex];
                const next = positions[nextIndex];
                const correlation = returnCorrelation(
                    returnsByAsset[current.assetIndex] ?? [],
                    returnsByAsset[next.assetIndex] ?? [],
                );

                if (correlation >= correlationThreshold) {
                    visited.add(nextIndex);
                    stack.push(nextIndex);
                }
            }
        }

        clusters.push(cluster);
    }

    return clusters;
};

const applyCorrelatedSameDirectionBudgetDedup = ({
    maxLookbackDays,
    positions,
    prepared,
    rebalanceIndex,
    representativeOnly,
}: {
    maxLookbackDays: number;
    positions: ActiveDualMomentumPosition[];
    prepared: PreparedAllocationData;
    rebalanceIndex: number;
    representativeOnly?: boolean;
}): PositionProcessorOutcome => {
    const returnsByAsset = selectedDailyReturns({
        endIndex: rebalanceIndex,
        prepared,
        startIndex: Math.max(0, rebalanceIndex - maxLookbackDays),
    });
    let cashWeight = 0;
    const nextPositions: ActiveDualMomentumPosition[] = [];

    (['long', 'short'] as const).forEach((direction) => {
        const sameDirectionPositions = positions.filter((position) => position.direction === direction);
        const clusters = connectedCorrelationClusters({
            correlationThreshold: 0.9,
            positions: sameDirectionPositions,
            returnsByAsset,
        });

        clusters.forEach((cluster) => {
            const clusterPositions = cluster.map((index) => sameDirectionPositions[index]);
            const grossWeightValue = clusterPositions.reduce((sum, position) => sum + position.weight, 0);
            const retainedWeight = Math.max(...clusterPositions.map((position) => position.weight));
            const retainedRatio = grossWeightValue > 0 ? retainedWeight / grossWeightValue : 1;

            cashWeight += grossWeightValue - retainedWeight;
            if (representativeOnly && clusterPositions.length > 1) {
                const representative = clusterPositions.reduce((best, position) =>
                    position.weight > best.weight ? position : best,
                );

                nextPositions.push({ ...representative, weight: retainedWeight });
                return;
            }

            clusterPositions.forEach((position) => {
                const weight = position.weight * retainedRatio;

                if (weight >= minimumPositionWeight) {
                    nextPositions.push({ ...position, weight });
                }
            });
        });
    });

    return { cashWeight, positions: nextPositions };
};

export const portfolioDownsideVolatility = ({
    endIndex,
    positions,
    prepared,
    startIndex,
}: {
    endIndex: number;
    positions: ActiveDualMomentumPosition[];
    prepared: PreparedAllocationData;
    startIndex: number;
}) => {
    const downsideReturns: number[] = [];

    for (let dayIndex = Math.max(1, startIndex + 1); dayIndex <= endIndex; dayIndex += 1) {
        const portfolioReturn = positions.reduce((sum, position) => {
            const prices = prepared.series[position.assetIndex].prices;
            const previousPrice = prices[dayIndex - 1] ?? 0;
            const currentPrice = prices[dayIndex] ?? previousPrice;
            const assetReturn = previousPrice > 0 ? currentPrice / previousPrice - 1 : 0;

            return sum + signedActiveDualMomentumWeight(position) * assetReturn;
        }, 0);

        if (portfolioReturn < 0) {
            downsideReturns.push(portfolioReturn);
        }
    }

    if (downsideReturns.length < 2) {
        return 0;
    }

    const mean = downsideReturns.reduce((sum, value) => sum + value, 0) / downsideReturns.length;
    const variance = downsideReturns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (downsideReturns.length - 1);

    return Math.sqrt(Math.max(0, variance));
};

export const resolveCashBufferMultiplier = ({
    baseMultiplier,
    config,
    grossPositions,
    maxLookbackDays,
    prepared,
    rebalanceIndex,
}: {
    baseMultiplier: number;
    config: NormalizedActiveDualMomentumConfig;
    grossPositions: ActiveDualMomentumPosition[];
    maxLookbackDays: number;
    prepared: PreparedAllocationData;
    rebalanceIndex: number;
}) => {
    if (config.researchProfile?.portfolioDownsideVolTarget === false) {
        return baseMultiplier;
    }

    const downsideVolatility = portfolioDownsideVolatility({
        endIndex: rebalanceIndex,
        positions: grossPositions,
        prepared,
        startIndex: Math.max(0, rebalanceIndex - maxLookbackDays),
    });
    const targetDailyDownsideVolatility = 0.01;
    const riskMultiplier = downsideVolatility > 0
        ? Math.min(1, targetDailyDownsideVolatility / downsideVolatility)
        : 1;

    return baseMultiplier * riskMultiplier;
};

const smoothRebalancePositions = ({
    assetCount,
    previousPositions,
    targetPositions,
    rebalanceStep,
    weightHoldBand,
}: {
    assetCount: number;
    previousPositions: ActiveDualMomentumPosition[];
    rebalanceStep?: number;
    targetPositions: ActiveDualMomentumPosition[];
    weightHoldBand?: number;
}) => {
    if (!rebalanceStep && !weightHoldBand) {
        return targetPositions;
    }

    const previousByAssetIndex = positionsByAssetIndex(previousPositions);
    const targetByAssetIndex = positionsByAssetIndex(targetPositions);
    const nextPositions: ActiveDualMomentumPosition[] = [];
    const step = rebalanceStep && rebalanceStep > 0 && rebalanceStep < 1 ? rebalanceStep : 1;

    for (let assetIndex = 0; assetIndex < assetCount; assetIndex += 1) {
        const previous = previousByAssetIndex.get(assetIndex);
        const target = targetByAssetIndex.get(assetIndex);

        if (!previous && !target) {
            continue;
        }

        const fromSigned = previous ? signedActiveDualMomentumWeight(previous) : 0;
        const toSigned = target ? signedActiveDualMomentumWeight(target) : 0;
        const diff = toSigned - fromSigned;
        const resolvedSigned = weightHoldBand && Math.abs(diff) < weightHoldBand
            ? fromSigned
            : fromSigned + diff * step;

        if (Math.abs(resolvedSigned) < minimumPositionWeight) {
            continue;
        }

        const template = target ?? previous;

        if (template) {
            nextPositions.push({
                ...template,
                direction: resolvedSigned < 0 ? 'short' : 'long',
                weight: Math.abs(resolvedSigned),
            });
        }
    }

    return nextPositions;
};

const applyProcessor = ({
    assetCount,
    cashBreakdownKey,
    id,
    processor,
    state,
    trace,
}: {
    assetCount: number;
    cashBreakdownKey: keyof Pick<ActiveDualMomentumCashBreakdown['explicit'], 'correlatedSameDirectionDedup' | 'crossSignOffset' | 'riskExitCooldown' | 'riskTrimCooldown'>;
    id: PositionProcessorId;
    processor: (positions: ActiveDualMomentumPosition[]) => PositionProcessorOutcome;
    state: { cash: ActiveDualMomentumCashBreakdown['explicit']; positions: ActiveDualMomentumPosition[] };
    trace: ActiveDualMomentumProcessorTrace[];
}) => {
    const inputPositions = state.positions;
    const outcome = processor(inputPositions);

    state.cash[cashBreakdownKey] += outcome.cashWeight;
    state.positions = outcome.positions;
    trace.push(traceProcessor({
        assetCount,
        cashWeight: outcome.cashWeight,
        id,
        inputPositions,
        outputPositions: outcome.positions,
    }));
};

export const resolveActiveDualMomentumPositionPipeline = ({
    assetCount,
    baseTargetPositions,
    cashInputs,
    config,
    maxLookbackDays,
    prepared,
    previousPositions,
    rebalanceIndex,
}: ActiveDualMomentumPositionPipelineInput): ActiveDualMomentumPositionPipelineResult => {
    const cash: ActiveDualMomentumCashBreakdown['explicit'] = {
        correlatedSameDirectionDedup: 0,
        crossSignOffset: 0,
        riskExitCooldown: 0,
        riskTrimCooldown: 0,
        sameAssetSleeveDedup: cashInputs.sameAssetSleeveDedup,
        sleeveFilter: cashInputs.sleeveFilter,
        standingBuffer: cashInputs.standingBuffer,
        total: 0,
    };
    const trace: ActiveDualMomentumProcessorTrace[] = [];
    const state = { cash, positions: baseTargetPositions };

    if (config.researchProfile?.correlatedSameDirectionBudgetDedup !== false) {
        applyProcessor({
            assetCount,
            cashBreakdownKey: 'correlatedSameDirectionDedup',
            id: 'correlated-same-direction-dedup',
            processor: (positions) => applyCorrelatedSameDirectionBudgetDedup({
                maxLookbackDays,
                positions,
                prepared,
                rebalanceIndex,
                representativeOnly: config.researchProfile?.correlatedSameDirectionClusterRepresentative !== false,
            }),
            state,
            trace,
        });
    }

    if (config.researchProfile?.crossSignOffsetCash !== false) {
        applyProcessor({
            assetCount,
            cashBreakdownKey: 'crossSignOffset',
            id: 'cross-sign-offset-cash',
            processor: applyCrossSignOffsetCash,
            state,
            trace,
        });
    }

    if (config.researchProfile?.riskExitRedeploymentCooldown !== false) {
        applyProcessor({
            assetCount,
            cashBreakdownKey: 'riskExitCooldown',
            id: 'risk-exit-redeployment-cooldown',
            processor: (positions) => applyRiskExitRedeploymentCooldown({
                assetCount,
                previousPositions,
                targetPositions: positions,
            }),
            state,
            trace,
        });
    }

    if (config.researchProfile?.riskTrimRedeploymentCooldown !== false) {
        applyProcessor({
            assetCount,
            cashBreakdownKey: 'riskTrimCooldown',
            id: 'risk-trim-redeployment-cooldown',
            processor: (positions) => applyRiskTrimRedeploymentCooldown({
                assetCount,
                previousPositions,
                targetPositions: positions,
            }),
            state,
            trace,
        });
    }

    const targetPositions = state.positions;
    const smoothedPositions = smoothRebalancePositions({
        assetCount,
        previousPositions,
        rebalanceStep: config.researchProfile?.rebalanceStep,
        targetPositions,
        weightHoldBand: config.researchProfile?.rebalanceWeightHoldBand,
    });

    trace.push(traceProcessor({
        assetCount,
        cashWeight: 0,
        id: 'rebalance-smoothing',
        inputPositions: targetPositions,
        outputPositions: smoothedPositions,
    }));

    cash.total = cash.sleeveFilter
        + cash.sameAssetSleeveDedup
        + cash.standingBuffer
        + cash.correlatedSameDirectionDedup
        + cash.crossSignOffset
        + cash.riskExitCooldown
        + cash.riskTrimCooldown;
    const residualCashWeight = Math.max(0, 1 - grossWeight(smoothedPositions));
    const resolvedCashWeight = config.researchProfile?.nettedResidualCashReturn !== false
        ? Math.max(cash.total, residualCashWeight)
        : cash.total;

    return {
        cashBreakdown: {
            explicit: cash,
            residual: residualCashWeight,
            resolvedTotal: resolvedCashWeight,
        },
        explicitCashWeight: cash.total,
        processorTrace: trace,
        residualCashWeight,
        resolvedCashWeight,
        targetPositions: smoothedPositions,
    };
};
