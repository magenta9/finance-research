export {
    CANONICAL_STRATEGY_IDS,
    resolveAllocationMode,
    resolveDefaultRebalanceCadence,
} from './strategy-metadata';

export type {
    AllocationStrategyHandler,
    AllocationStrategyRegistry,
    StrategyAnalysisInput,
    StrategyExecutionContext,
    StrategyExecutionResult,
    StrategyOptimizationRequest,
    StrategyOptimizationResult,
} from './strategy-contracts';

export {
    defaultAllocationStrategyRegistry,
} from './strategy-registry';

export { buildAllocationAnalysisInput } from './allocation-analysis-input';
export type { AllocationAnalysisInput } from './allocation-analysis-input';

export type {
    PreparedAllocationData,
    PreparedAssetSeries,
} from './preprocessor';

export { optimizeWeights } from './optimizer';

export { resolveStrategyHandler } from './strategy-runtime';
