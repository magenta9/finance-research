import type { ActiveDualMomentumDiagnostics, AllocationResult } from '../../desktop/quantdesk/packages/shared/src/types/domain';

import type { EvalCaseInput, EvalResultRow, StrategyRunInput } from './eval_runner_contract';

export const projectAllocationResult = ({
    evalCase,
    extraResultFields = [],
    result,
    strategyRun,
}: {
    evalCase: EvalCaseInput;
    extraResultFields?: string[];
    result: AllocationResult;
    strategyRun: StrategyRunInput;
}): EvalResultRow => {
    const diagnostics = result.diagnostics;
    const admDiagnostics = (diagnostics as { activeDualMomentum?: ActiveDualMomentumDiagnostics }).activeDualMomentum;
    const metadata: Record<string, unknown> = {};

    if (extraResultFields.includes('calmarRatio')) {
        metadata.calmarRatio = admDiagnostics?.calmarRatio ?? null;
    }

    if (extraResultFields.includes('winRate')) {
        metadata.winRate = admDiagnostics?.winRate ?? null;
    }

    if (result.error) {
        return {
            basketSize: evalCase.basketSize,
            caseId: evalCase.caseId,
            endDate: evalCase.endDate,
            error: result.error.message,
            metadata,
            rebalanceCadence: evalCase.rebalanceCadence,
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
        error: null,
        metadata,
        metrics: result.portfolioMetrics,
        rebalanceCadence: evalCase.rebalanceCadence,
        rebalanceEventCount: diagnostics.rebalanceEventCount ?? null,
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
    rebalanceCadence: evalCase.rebalanceCadence,
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
    rebalanceCadence: evalCase.rebalanceCadence,
    sampleIndex: evalCase.sampleIndex,
    startDate: evalCase.startDate,
    status: 'skipped',
    strategyId: strategyRun.strategyId,
    symbols: evalCase.symbols,
    windowYears: evalCase.windowYears,
});
