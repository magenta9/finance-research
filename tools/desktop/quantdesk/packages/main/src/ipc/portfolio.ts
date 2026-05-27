import type {
    AllocationConstraints,
    AllocationPlanInput,
    AllocationStrategy,
    AllocationStrategyMix,
    AllocationType,
} from '@quantdesk/shared';

import type { PortfolioEngine } from '../portfolio/engine';
import type { ContractBinder } from './contract-binder';

export const createPortfolioHandlers = (portfolioEngine: PortfolioEngine) => ({
    deletePlan: (id: string) => portfolioEngine.deletePlan(id),
    getPlans: () => portfolioEngine.listPlans(),
    runAllocation: (request: {
        assetIds: string[];
        strategy?: AllocationStrategy;
        mode: AllocationType;
        constraints: AllocationConstraints;
        baseCurrency?: string;
        startDate?: string;
        endDate?: string;
        strategyMix?: AllocationStrategyMix;
    }) => portfolioEngine.runAllocation({
        ...request,
        baseCurrency: request.baseCurrency as Parameters<PortfolioEngine['runAllocation']>[0]['baseCurrency'],
    }),
    savePlan: (plan: AllocationPlanInput) => portfolioEngine.savePlan(plan),
});

const createUnavailablePortfolioHandlers = (message: string) => ({
    deletePlan: async () => {
        throw new Error(message);
    },
    getPlans: async () => {
        throw new Error(message);
    },
    runAllocation: async () => {
        throw new Error(message);
    },
    savePlan: async () => {
        throw new Error(message);
    },
});

export const registerPortfolioIpc = (
    binder: ContractBinder,
    portfolioEngine?: PortfolioEngine,
) => {
    const handlers = portfolioEngine
        ? createPortfolioHandlers(portfolioEngine)
        : createUnavailablePortfolioHandlers('Portfolio engine is not available.');

    binder.registerInvokeNamespace('portfolio', handlers);
};