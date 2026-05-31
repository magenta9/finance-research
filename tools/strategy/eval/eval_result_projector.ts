import type { ActiveDualMomentumDiagnostics, AllocationResult } from '@quantdesk/shared';

import type {
    EvalCaseInput,
    EvalResultRow,
    StrategyRunInput,
} from './eval_runner_contract';

const pickMetadata = (
    result: AllocationResult,
    extraResultFields?: string[],
): Record<string, unknown> | undefined => {
    if (!extraResultFields?.length) {
        return undefined;
    }

    const metadata: Record<string, unknown> = {};

    for (const field of extraResultFields) {
        if (field === 'activeDualMomentumDiagnostics') {
            const diagnostics = result.diagnostics.activeDualMomentum as ActiveDualMomentumDiagnostics | undefined;

            if (diagnostics) {
                metadata.activeDualMomentumDiagnostics = diagnostics;
            }
        }
    }

    return Object.keys(metadata).length > 0 ? metadata : undefined;
};

export const projectAllocationResult = ({
    evalCase,
    extraResultFields,
    result,
    strategyRun,
}: {
    evalCase: EvalCaseInput;
    extraResultFields?: string[];
    result: AllocationResult;
    strategyRun: StrategyRunInput;
}): EvalResultRow => {
    if (result.error) {
        return {
            basketSize: evalCase.basketSize,
            caseId: evalCase.caseId,
            endDate: evalCase.endDate,
            error: result.error.message,
            sampleIndex: evalCase.sampleIndex,
            startDate: evalCase.startDate,
            status: 'error',
            strategyId: strategyRun.strategyId,
            symbols: evalCase.symbols,
            windowYears: evalCase.windowYears,
        };
    }

    return {
        basketSize: evalCase.basketSize,
        caseId: evalCase.caseId,
        endDate: evalCase.endDate,
        metadata: pickMetadata(result, extraResultFields),
        metrics: result.portfolioMetrics,
        rebalanceCadence: result.diagnostics.rebalanceCadence,
        rebalanceEventCount: result.diagnostics.rebalanceEventCount,
        sampleIndex: evalCase.sampleIndex,
        startDate: evalCase.startDate,
        status: 'ok',
        strategyId: strategyRun.strategyId,
        symbols: evalCase.symbols,
        windowYears: evalCase.windowYears,
    };
};

export const projectErrorRow = ({
    evalCase,
    error,
    strategyRun,
}: {
    evalCase: EvalCaseInput;
    error: unknown;
    strategyRun: StrategyRunInput;
}): EvalResultRow => ({
    basketSize: evalCase.basketSize,
    caseId: evalCase.caseId,
    endDate: evalCase.endDate,
    error: error instanceof Error ? error.message : String(error),
    sampleIndex: evalCase.sampleIndex,
    startDate: evalCase.startDate,
    status: 'error',
    strategyId: strategyRun.strategyId,
    symbols: evalCase.symbols,
    windowYears: evalCase.windowYears,
});

export const projectSkippedRow = ({
    evalCase,
    reason,
    strategyRun,
}: {
    evalCase: EvalCaseInput;
    reason: string;
    strategyRun: StrategyRunInput;
}): EvalResultRow => ({
    basketSize: evalCase.basketSize,
    caseId: evalCase.caseId,
    endDate: evalCase.endDate,
    error: reason,
    sampleIndex: evalCase.sampleIndex,
    startDate: evalCase.startDate,
    status: 'skipped',
    strategyId: strategyRun.strategyId,
    symbols: evalCase.symbols,
    windowYears: evalCase.windowYears,
});
