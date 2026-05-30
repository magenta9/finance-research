import type { AllocationResult } from '@quantdesk/shared';

import { getPreparedPriceSeries } from './prepared-allocation-context';
import type { PreparedAllocationData } from './preprocessor';
import {
    annualizedReturns,
    annualizedVolatility,
    computeLogReturns,
    covarianceMatrix,
    shrinkCovarianceMatrix,
} from './statistics';

export interface AllocationAnalysisInput {
    annualizedAssetVolatility: number[];
    annualizedMeanReturns: number[];
    shrunkCovariance: number[][];
}

export type AllocationAnalysisInputResult =
    | { analysisInput: AllocationAnalysisInput; ok: true }
    | { error: NonNullable<AllocationResult['error']>; ok: false };

export const buildAllocationAnalysisInput = (prepared: PreparedAllocationData): AllocationAnalysisInputResult => {
    const priceSeries = getPreparedPriceSeries(prepared);
    const returns = computeLogReturns(priceSeries);

    if (returns[0]?.length < 60) {
        return {
            error: {
                code: 'INSUFFICIENT_HISTORY',
                message: '已选标的在当前窗口内的共同覆盖不足 61 个交易日。',
                suggestions: ['缩短时间窗口。', '减少已选标的数量。'],
            },
            ok: false,
        };
    }

    const sampleCovariance = covarianceMatrix(returns);
    const shrunkCovariance = shrinkCovarianceMatrix(sampleCovariance);

    return {
        analysisInput: {
            annualizedAssetVolatility: annualizedVolatility(shrunkCovariance),
            annualizedMeanReturns: annualizedReturns(returns),
            shrunkCovariance,
        },
        ok: true,
    };
};
