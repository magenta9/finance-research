import type {
    AllocationConstraints,
    AllocationDiagnostics,
    AllocationResult,
    AllocationStrategy,
    AllocationStrategyMix,
    AllocationType,
    Currency,
    RebalanceCadence,
} from '@quantdesk/shared';

import type { AllocationAnalysisInput } from './allocation-analysis-input';
import type { PreparedAllocationData } from './preprocessor';

export type StrategyAnalysisInput = AllocationAnalysisInput;

export interface StrategyOptimizationRequest {
    annualizedAssetVolatility: number[];
    assetIndexes: number[];
    constraints: AllocationConstraints;
    covariance: number[][];
    mode: AllocationType;
    prepared: PreparedAllocationData;
}

export type StrategyOptimizationResult =
    | {
        diagnostics: Partial<AllocationDiagnostics>;
        diversificationRatio?: number;
        ok: true;
        optimizer: 'js' | 'python';
        weights: number[];
    }
    | {
        error: NonNullable<AllocationResult['error']>;
        ok: false;
        optimizerPath: 'js' | 'python' | null;
    };

export interface StrategyExecutionContext {
    analysisInput: StrategyAnalysisInput;
    baseCurrency: Currency;
    calculationDateRange: { endDate: string; startDate: string };
    constraints: AllocationConstraints;
    mode: AllocationType;
    optimize: (request: StrategyOptimizationRequest) => Promise<StrategyOptimizationResult>;
    prepared: PreparedAllocationData;
    rebalanceCadence: RebalanceCadence;
    strategyMix?: AllocationStrategyMix;
}

export interface StrategyExecutionResult {
    optimizerPath: 'js' | 'python' | null;
    result: AllocationResult;
    stage: 'completed' | 'constraint_failed' | 'optimization_failed';
}

export interface AllocationStrategyHandler {
    run: (context: StrategyExecutionContext) => Promise<StrategyExecutionResult>;
}

export type AllocationStrategyRegistry = Record<AllocationStrategy, AllocationStrategyHandler>;
