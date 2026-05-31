import { correlationMatrix } from './statistics';

const WEIGHT_EPSILON = 1e-12;
const MAX_ITERATIONS = 12;

const connectedCorrelationClusters = (
    correlations: number[][],
    correlationThreshold: number,
) => {
    const assetCount = correlations.length;
    const visited = new Set<number>();
    const clusters: number[][] = [];

    for (let startIndex = 0; startIndex < assetCount; startIndex += 1) {
        if (visited.has(startIndex)) {
            continue;
        }

        const cluster: number[] = [];
        const stack = [startIndex];
        visited.add(startIndex);

        while (stack.length > 0) {
            const currentIndex = stack.pop() ?? startIndex;
            cluster.push(currentIndex);

            for (let nextIndex = 0; nextIndex < assetCount; nextIndex += 1) {
                if (visited.has(nextIndex) || nextIndex === currentIndex) {
                    continue;
                }

                const correlation = correlations[currentIndex]?.[nextIndex] ?? 0;

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

/**
 * Cap total weight per high-correlation cluster (Tola & Lillo 2008; cluster risk parity).
 * Defaults: ρ ≥ 0.70, max 45% per cluster.
 */
export const applyCorrelationClusterWeightCap = ({
    covariance,
    weights,
    correlationThreshold = 0.7,
    maxClusterWeight = 0.45,
}: {
    covariance: number[][];
    weights: number[];
    correlationThreshold?: number;
    maxClusterWeight?: number;
}) => {
    const originalTotal = weights.reduce((sum, weight) => sum + weight, 0);

    if (originalTotal <= WEIGHT_EPSILON || maxClusterWeight <= 0) {
        return weights;
    }

    const correlations = correlationMatrix(covariance);
    const clusters = connectedCorrelationClusters(correlations, correlationThreshold);
    let adjusted = [...weights];

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
        let changed = false;

        for (const cluster of clusters) {
            if (cluster.length < 2) {
                continue;
            }

            const clusterTotal = cluster.reduce((sum, index) => sum + (adjusted[index] ?? 0), 0);

            if (clusterTotal <= maxClusterWeight + WEIGHT_EPSILON) {
                continue;
            }

            const excess = clusterTotal - maxClusterWeight;
            const scale = maxClusterWeight / clusterTotal;
            cluster.forEach((index) => {
                adjusted[index] = (adjusted[index] ?? 0) * scale;
            });

            const outsideCluster = adjusted
                .map((weight, index) => ({ index, weight }))
                .filter(({ index, weight }) => !cluster.includes(index) && weight > WEIGHT_EPSILON);
            const outsideTotal = outsideCluster.reduce((sum, entry) => sum + entry.weight, 0);

            if (outsideTotal <= WEIGHT_EPSILON) {
                continue;
            }

            outsideCluster.forEach(({ index, weight }) => {
                adjusted[index] = weight + excess * (weight / outsideTotal);
            });
            changed = true;
        }

        if (!changed) {
            break;
        }
    }

    return adjusted;
};
