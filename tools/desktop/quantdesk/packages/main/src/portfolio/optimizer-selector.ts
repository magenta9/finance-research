export type AllocationOptimizerPath = 'js' | 'python';

export interface AllocationOptimizerSelectorInput {
    assetCount: number;
}

export interface AllocationOptimizerSelector {
    selectOptimizer(input: AllocationOptimizerSelectorInput): AllocationOptimizerPath;
}

export class SizeBasedAllocationOptimizerSelector implements AllocationOptimizerSelector {
    private readonly pythonThreshold: number;

    constructor(pythonThreshold = 20) {
        this.pythonThreshold = pythonThreshold;
    }

    selectOptimizer({ assetCount }: AllocationOptimizerSelectorInput): AllocationOptimizerPath {
        return assetCount > this.pythonThreshold ? 'python' : 'js';
    }
}
