import { Matrix, solve } from 'ml-matrix';

import type { AllocationConstraints, AllocationDiagnostics, AssetClass, AllocationType } from '@quantdesk/shared';

import { computeDiversificationRatio, computeRiskContributions, maxRiskContributionGap } from './statistics';

const EPSILON = 1e-8;
export const ERC_MAX_ITERATIONS = 500;

export interface OptimizerInput {
    assetClasses: AssetClass[];
    constraints: AllocationConstraints;
    covariance: number[][];
    mode: AllocationType;
    volatilities: number[];
}

export interface OptimizerComputationResult {
    weights: number[];
    diagnostics: AllocationDiagnostics;
    diversificationRatio?: number;
}

const normalize = (weights: number[]) => {
    const total = weights.reduce((sum, value) => sum + value, 0);

    if (Math.abs(total) <= EPSILON) {
        return weights.map(() => 1 / weights.length);
    }

    return weights.map((value) => value / total);
};

const sumWeights = (weights: number[]) =>
    weights.reduce((sum, value) => sum + value, 0);

const scaleToUnitSum = (weights: number[]) => {
    const total = sumWeights(weights);

    if (Math.abs(total) <= EPSILON) {
        return weights.map(() => 1 / weights.length);
    }

    return weights.map((weight) => weight / total);
};

const uniqueClasses = (assetClasses: AssetClass[]) => [...new Set(assetClasses)];

const getClassIndices = (assetClasses: AssetClass[], assetClass: AssetClass) =>
    assetClasses.reduce<number[]>((indices, value, index) => {
        if (value === assetClass) {
            indices.push(index);
        }

        return indices;
    }, []);

const getClassWeight = (
    weights: number[],
    assetClasses: AssetClass[],
    assetClass: AssetClass,
) =>
    getClassIndices(assetClasses, assetClass).reduce(
        (sum, index) => sum + weights[index],
        0,
    );

const validateConstraints = (assetCount: number, constraints: AllocationConstraints) => {
    if (!constraints.allowLeverage && constraints.maxSingleWeight * assetCount < 1) {
        throw new Error('Single-asset maximum weight makes the constraint set infeasible.');
    }

    if (constraints.maxSingleWeight <= 0) {
        throw new Error('Single-asset maximum weight must be greater than zero.');
    }
};

const validateClassConstraints = (
    assetClasses: AssetClass[],
    constraints: AllocationConstraints,
) => {
    if (constraints.allowLeverage) {
        return;
    }

    const maxReachableWeight = uniqueClasses(assetClasses).reduce((sum, assetClass) => {
        const classCap = constraints.maxClassWeight[assetClass] ?? 1;
        const assetCount = assetClasses.filter((value) => value === assetClass).length;
        return sum + Math.min(classCap, assetCount * constraints.maxSingleWeight);
    }, 0);

    if (maxReachableWeight < 1 - EPSILON) {
        throw new Error('Class maximum weights sum to less than 100%, so the constraint set is infeasible.');
    }
};

const applyClassCaps = (
    weights: number[],
    assetClasses: AssetClass[],
    classCaps: AllocationConstraints['maxClassWeight'],
) => {
    const nextWeights = [...weights];

    for (const [assetClass, cap] of Object.entries(classCaps) as Array<[AssetClass, number]>) {
        if (cap == null) {
            continue;
        }

        const indices = getClassIndices(assetClasses, assetClass);

        if (indices.length === 0) {
            continue;
        }

        const classWeight = indices.reduce((sum, index) => sum + nextWeights[index], 0);

        if (classWeight <= cap + EPSILON || classWeight <= EPSILON) {
            continue;
        }

        const scale = cap / classWeight;

        for (const index of indices) {
            nextWeights[index] *= scale;
        }
    }

    return nextWeights;
};

const reduceExcess = (weights: number[]) => {
    const total = sumWeights(weights);

    if (total <= 1 + EPSILON) {
        return [...weights];
    }

    return weights.map((weight) => weight / total);
};

const distributeDeficit = (
    weights: number[],
    assetClasses: AssetClass[],
    constraints: AllocationConstraints,
    preferredWeights: number[],
) => {
    const nextWeights = [...weights];
    let remaining = 1 - sumWeights(nextWeights);

    for (let iteration = 0; iteration < nextWeights.length * 4 && remaining > EPSILON; iteration += 1) {
        const classWeights = Object.fromEntries(
            uniqueClasses(assetClasses).map((assetClass) => [
                assetClass,
                getClassWeight(nextWeights, assetClasses, assetClass),
            ]),
        ) as Record<AssetClass, number>;
        const slacks = nextWeights.map((weight, index) => {
            const assetClass = assetClasses[index];
            const singleSlack = Math.max(0, constraints.maxSingleWeight - weight);
            const classCap = constraints.maxClassWeight[assetClass] ?? 1;
            const classSlack = Math.max(0, classCap - (classWeights[assetClass] ?? 0));

            return Math.min(singleSlack, classSlack);
        });
        const totalSlack = sumWeights(slacks);

        if (totalSlack <= EPSILON) {
            throw new Error('Unable to satisfy allocation constraints after applying caps.');
        }

        const eligiblePreferences = preferredWeights.map((weight, index) =>
            slacks[index] > EPSILON ? Math.max(weight, EPSILON) : 0,
        );
        const totalPreference = sumWeights(eligiblePreferences);
        let distributed = 0;

        for (let index = 0; index < nextWeights.length; index += 1) {
            if (slacks[index] <= EPSILON) {
                continue;
            }

            const baseShare = totalPreference > EPSILON
                ? eligiblePreferences[index] / totalPreference
                : 1 / nextWeights.length;
            const addition = Math.min(slacks[index], remaining * baseShare);

            nextWeights[index] += addition;
            distributed += addition;
        }

        if (distributed <= EPSILON) {
            for (let index = 0; index < nextWeights.length && remaining > EPSILON; index += 1) {
                const addition = Math.min(slacks[index], remaining);

                if (addition <= EPSILON) {
                    continue;
                }

                nextWeights[index] += addition;
                distributed += addition;
                remaining -= addition;
            }

            if (distributed <= EPSILON) {
                throw new Error('Unable to satisfy allocation constraints after applying caps.');
            }
        }

        remaining = 1 - sumWeights(nextWeights);
    }

    return scaleToUnitSum(nextWeights);
};

const projectWeights = (
    weights: number[],
    constraints: AllocationConstraints,
    assetClasses: AssetClass[],
) => {
    validateClassConstraints(assetClasses, constraints);

    let nextWeights = constraints.allowShort
        ? normalize(weights)
        : normalize(weights.map((weight) => Math.max(0, weight)));
    const preferredWeights = nextWeights.map((weight) => Math.max(weight, EPSILON));

    for (let iteration = 0; iteration < 12; iteration += 1) {
        if (!constraints.allowShort) {
            nextWeights = nextWeights.map((weight) => Math.max(0, weight));
        }

        nextWeights = nextWeights.map((weight) => Math.min(weight, constraints.maxSingleWeight));
        nextWeights = applyClassCaps(nextWeights, assetClasses, constraints.maxClassWeight);
        nextWeights = reduceExcess(nextWeights);

        const total = sumWeights(nextWeights);

        if (total < 1 - EPSILON) {
            nextWeights = distributeDeficit(
                nextWeights,
                assetClasses,
                constraints,
                preferredWeights,
            );
        }

        const totalAfterProjection = sumWeights(nextWeights);
        const singleCapSatisfied = nextWeights.every(
            (weight) => weight <= constraints.maxSingleWeight + 1e-6,
        );
        const classCapsSatisfied = uniqueClasses(assetClasses).every((assetClass) => {
            const cap = constraints.maxClassWeight[assetClass];

            if (cap == null) {
                return true;
            }

            return getClassWeight(nextWeights, assetClasses, assetClass) <= cap + 1e-6;
        });

        if (
            singleCapSatisfied
            && classCapsSatisfied
            && Math.abs(totalAfterProjection - 1) <= 1e-6
        ) {
            return nextWeights;
        }
    }

    throw new Error('Unable to satisfy allocation constraints after iterative projection.');
};

const runNaiveRiskParityFallback = (covariance: number[][], constraints: AllocationConstraints, assetClasses: AssetClass[]) => {
    let weights = Array.from({ length: covariance.length }, () => 1 / covariance.length);

    for (let iteration = 0; iteration < 400; iteration += 1) {
        const contributions = computeRiskContributions(weights, covariance);
        const targetContribution = 1 / contributions.length;

        weights = weights.map((weight, index) => weight * (targetContribution / Math.max(contributions[index], 1e-6)));
        weights = projectWeights(weights, constraints, assetClasses);
    }

    return weights;
};

const runInverseVolatility = (
    volatilities: number[],
    constraints: AllocationConstraints,
    assetClasses: AssetClass[],
): OptimizerComputationResult => {
    const rawScores = volatilities.map((vol) => 1 / Math.max(vol, EPSILON));
    const weights = projectWeights(rawScores, constraints, assetClasses);
    const warnings: string[] = [];

    for (let i = 0; i < volatilities.length; i += 1) {
        if (!Number.isFinite(volatilities[i]) || volatilities[i] <= 0) {
            warnings.push(`Asset ${i} has non-positive or non-finite volatility (${volatilities[i]}), clamped to epsilon.`);
        }
    }

    return {
        weights,
        diagnostics: {
            optimizer: 'js',
            alignedDates: 0,
            excludedAssets: [],
            warnings,
        },
    };
};

const runErc = (
    covariance: number[][],
    constraints: AllocationConstraints,
    assetClasses: AssetClass[],
): OptimizerComputationResult => {
    const n = covariance.length;
    let weights = Array.from({ length: n }, () => 1 / n);
    const targetContribution = 1 / n;
    const maxIterations = ERC_MAX_ITERATIONS;
    const convergenceThreshold = 1e-8;
    let learningRate = 0.01;
    let converged = false;
    let lastGap = Infinity;
    let iterations = maxIterations;

    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
        if (iteration > 0 && iteration % 100 === 0) {
            learningRate *= 0.5;
        }

        const contributions = computeRiskContributions(weights, covariance);
        const gap = maxRiskContributionGap(weights, covariance);
        lastGap = gap;

        if (gap < convergenceThreshold) {
            converged = true;
            iterations = iteration + 1;
            break;
        }

        weights = weights.map((weight, index) => {
            const deviation = contributions[index] - targetContribution;
            return weight - learningRate * deviation * weight;
        });

        weights = projectWeights(weights, constraints, assetClasses);
    }

    if (converged) {
        return {
            weights,
            diagnostics: {
                optimizer: 'js',
                alignedDates: 0,
                excludedAssets: [],
                warnings: [],
                fallbackUsed: false,
                erc: {
                    converged: true,
                    iterations,
                    maxContributionGap: lastGap,
                    convergenceWarning: false,
                },
            },
        };
    }

    // Fallback to naive risk parity approximation (≈ inverse volatility)
    const fallbackWeights = runNaiveRiskParityFallback(covariance, constraints, assetClasses);
    const fallbackGap = maxRiskContributionGap(fallbackWeights, covariance);

    return {
        weights: fallbackWeights,
        diagnostics: {
            optimizer: 'js',
            alignedDates: 0,
            excludedAssets: [],
            warnings: ['ERC did not converge within 500 iterations; fell back to naive risk parity approximation.'],
            fallbackUsed: true,
            fallbackReason: 'erc_non_converged',
            fallbackEquivalentMode: 'inverse_volatility',
            erc: {
                converged: false,
                iterations: maxIterations,
                maxContributionGap: fallbackGap,
                convergenceWarning: true,
            },
        },
    };
};

const runMaxDiversification = (
    covariance: number[][],
    volatilities: number[],
    constraints: AllocationConstraints,
    assetClasses: AssetClass[],
): OptimizerComputationResult => {
    const n = covariance.length;
    const volVector = Matrix.columnVector(volatilities);
    let covMatrix = new Matrix(covariance);
    let direction: number[];

    try {
        direction = solve(covMatrix, volVector).to1DArray();
    } catch (error) {
        // Diagonal loading regularization
        try {
            const diagLoad = Matrix.eye(n, n, Math.max(...volatilities.map((v) => v * v)) * 0.01);
            covMatrix = covMatrix.add(diagLoad);
            direction = solve(covMatrix, volVector).to1DArray();
        } catch (regularizedError) {
            // Final fallback: equal weight
            const equalWeights = projectWeights(
                Array.from({ length: n }, () => 1 / n),
                constraints,
                assetClasses,
            );
            return {
                weights: equalWeights,
                diversificationRatio: computeDiversificationRatio(equalWeights, covariance, volatilities),
                diagnostics: {
                    optimizer: 'js',
                    alignedDates: 0,
                    excludedAssets: [],
                    warnings: [
                        `MDP solver failed after regularization; fell back to equal weight. Initial error: ${error instanceof Error ? error.message : String(error)}. Final error: ${regularizedError instanceof Error ? regularizedError.message : String(regularizedError)}.`,
                    ],
                    fallbackUsed: true,
                    fallbackReason: 'singular_matrix',
                    fallbackEquivalentMode: 'equal_weight',
                },
            };
        }
    }

    const weights = projectWeights(direction, constraints, assetClasses);
    const dr = computeDiversificationRatio(weights, covariance, volatilities);

    return {
        weights,
        diversificationRatio: dr,
        diagnostics: {
            optimizer: 'js',
            alignedDates: 0,
            excludedAssets: [],
            warnings: [],
            fallbackUsed: false,
        },
    };
};

export const optimizeWeights = ({
    assetClasses,
    constraints,
    covariance,
    mode,
    volatilities,
}: OptimizerInput): OptimizerComputationResult => {
    validateConstraints(covariance.length, constraints);

    if (constraints.allowShort) {
        throw new Error('Short selling is not supported by the current allocation modes.');
    }

    if (constraints.allowLeverage) {
        throw new Error('Leverage is not supported by the current allocation modes.');
    }

    switch (mode) {
        case 'erc':
            return runErc(covariance, constraints, assetClasses);
        case 'inverse_volatility':
            return runInverseVolatility(volatilities, constraints, assetClasses);
        case 'max_diversification':
            return runMaxDiversification(covariance, volatilities, constraints, assetClasses);
    }
};
