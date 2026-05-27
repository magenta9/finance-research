import type {
    AllocationConstraints,
    AllocationResult,
    AllocationStrategyMix,
    AllocationType,
    AllocationPlanInput,
    Currency,
    RebalanceCadence,
} from '@quantdesk/shared';

import type { DataServices } from '../db/services';
import type { MarketDataOrchestrator } from '../sidecar/market-data-orchestrator';
import type { SidecarRpc } from '../sidecar/runtime-types';
import { AllocationPreparationService } from './preparation-service';
import { PortfolioAllocationPipeline } from './pipeline';
import { PreparationRepositoryAdapter } from './preparation-repository-adapter';

export class PortfolioEngine {
    private readonly dataServices: DataServices;

    private readonly pipeline: PortfolioAllocationPipeline;

    private readonly preparationService: AllocationPreparationService;

    constructor(
        dataServices: DataServices,
        sidecarRuntime: SidecarRpc,
        marketDataOrchestrator: Pick<MarketDataOrchestrator, 'ensure'>,
        preparationService?: AllocationPreparationService,
        options?: { shouldSkipInteractiveSync?: () => boolean },
    ) {
        this.dataServices = dataServices;
        this.preparationService = preparationService ?? new AllocationPreparationService({
            marketDataOrchestrator,
            reader: new PreparationRepositoryAdapter(dataServices.repositories),
            shouldSkipInteractiveSync: options?.shouldSkipInteractiveSync,
        });
        this.pipeline = new PortfolioAllocationPipeline(this.preparationService, sidecarRuntime);
    }

    async runAllocation({
        assetIds,
        baseCurrency = 'CNY',
        constraints,
        mode,
        endDate,
        startDate,
        rebalanceCadence = 'none',
        strategyMix,
    }: {
        assetIds: string[];
        baseCurrency?: Currency;
        constraints: AllocationConstraints;
        mode: AllocationType;
        startDate?: string;
        endDate?: string;
        rebalanceCadence?: RebalanceCadence;
        strategyMix?: AllocationStrategyMix;
    }): Promise<AllocationResult> {
        const outcome = await this.pipeline.allocate({
            assetIds,
            baseCurrency,
            constraints,
            endDate,
            mode,
            rebalanceCadence,
            startDate,
            strategyMix,
        });

        return outcome.result;
    }

    savePlan(plan: AllocationPlanInput) {
        return this.dataServices.repositories.allocationPlanRepository.save(plan);
    }

    listPlans() {
        return this.dataServices.repositories.allocationPlanRepository.list();
    }

    deletePlan(id: string) {
        return this.dataServices.repositories.allocationPlanRepository.delete(id);
    }
}
