import type { PreparedAllocationData } from './preprocessor';
import type { ActiveDualMomentumPosition } from './active-dual-momentum-rules';

const minimumPositionWeight = 0.000001;

export interface ActiveDualMomentumCorrelationDedupResult {
    cashWeight: number;
    positions: ActiveDualMomentumPosition[];
}

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

export const applyActiveDualMomentumCorrelationDedup = ({
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
}): ActiveDualMomentumCorrelationDedupResult => {
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
            const grossWeight = clusterPositions.reduce((sum, position) => sum + position.weight, 0);
            const retainedWeight = Math.max(...clusterPositions.map((position) => position.weight));
            const retainedRatio = grossWeight > 0 ? retainedWeight / grossWeight : 1;

            cashWeight += grossWeight - retainedWeight;
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
