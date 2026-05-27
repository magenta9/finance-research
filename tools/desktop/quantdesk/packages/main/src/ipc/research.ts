import type { ResearchRequestInput, ResearchRequestListQuery, ResearchRuntimeMode, RiskProfileSnapshot } from '@quantdesk/shared';

import type { DataServices } from '../db/services';
import { ResearchDirector } from '../research/director';
import { ResearchEventBus } from '../research/event-bus';
import { createDeterministicResearchExecutor, type ResearchExecutor } from '../research/executor';
import type { PiRiskGatePreferences } from '../pi/preferences';
import type { MarketDataPublicApi } from '../sidecar/market-data-orchestrator';
import { validateResearchRequestInput, validateRiskProfileSnapshot } from '../research/input-validator';
import { PiNativeResearchRunner } from '../research/pi-native-runner';
import { createPiRuntimeDegradationReason } from '../research/pi-runtime-preflight';
import { createPiResearchExecutor, type PiResearchRuntime } from '../research/pi-executor';
import { createRiskProfileService } from '../research/risk-profile-service';
import { getPriceProviderOrder } from '../sidecar/market-data-contracts';
import type { ContractBinder } from './contract-binder';

export interface ResearchHandlersDependencies {
    dataServices: DataServices;
    director?: ResearchDirector;
    eventBus?: ResearchEventBus;
    marketDataResolver?: Pick<MarketDataPublicApi, 'ensure' | 'lookup'>;
    piRuntime?: PiResearchRuntime;
    riskGatePreferences?: PiRiskGatePreferences;
    researchRuntimeMode?: ResearchRuntimeMode;
}

const resolveResearchRuntimeMode = (researchRuntimeMode?: ResearchRuntimeMode) => {
    if (researchRuntimeMode) {
        return researchRuntimeMode;
    }

    const environmentMode = process.env.QUANTDESK_RESEARCH_RUNTIME;

    return environmentMode === 'deterministic' || environmentMode === 'pi' || environmentMode === 'pi-native'
        ? environmentMode
        : 'pi-native';
};

const createRuntimeResolutionError = (message: string, runtimeMode: ResearchRuntimeMode) => Object.assign(new Error(message), { runtimeMode });

const getPiRiskGateError = (riskGatePreferences: PiRiskGatePreferences | undefined) => {
    const state = riskGatePreferences?.getRiskGateState();

    return state && !state.acknowledged
        ? state.message || 'Agent high-privilege risk must be acknowledged before research.'
        : null;
};

const resolveResearchExecutor = async ({
    piRuntime,
    riskGatePreferences,
    researchRuntimeMode,
}: Pick<ResearchHandlersDependencies, 'piRuntime' | 'riskGatePreferences' | 'researchRuntimeMode'>): Promise<ResearchExecutor> => {
    const resolvedMode = resolveResearchRuntimeMode(researchRuntimeMode);

    if (resolvedMode === 'deterministic') {
        return createDeterministicResearchExecutor();
    }

    if (resolvedMode === 'pi-native') {
        throw createRuntimeResolutionError('Pi native research must be handled by PiNativeResearchRunner.', 'pi-native');
    }

    const riskGateError = getPiRiskGateError(riskGatePreferences);

    if (riskGateError) {
        throw createRuntimeResolutionError(riskGateError, 'pi');
    }

    const runtimeDegradationReason = await createPiRuntimeDegradationReason(piRuntime);

    if (runtimeDegradationReason) {
        throw createRuntimeResolutionError(runtimeDegradationReason, 'pi');
    }

    if (!piRuntime) {
        throw createRuntimeResolutionError('Agent runtime is unavailable.', 'pi');
    }

    return createPiResearchExecutor({ piRuntime });
};

export const createResearchHandlers = ({
    dataServices,
    director,
    eventBus = new ResearchEventBus(),
    marketDataResolver,
    piRuntime,
    riskGatePreferences,
    researchRuntimeMode,
}: ResearchHandlersDependencies) => {
    const riskProfileService = createRiskProfileService(dataServices.repositories.preferencesRepository);
    const resolvedMode = resolveResearchRuntimeMode(researchRuntimeMode);

    if (!director && resolvedMode === 'pi-native') {
        const runner = new PiNativeResearchRunner({
            eventBus,
            marketDataResolver,
            piRuntime,
            repositories: dataServices.repositories,
            repository: dataServices.repositories.researchArtifactRepository,
            riskGatePreferences,
            riskProfileService,
        });

        return {
            cancelResearch: (requestId: string) => runner.cancelResearch(requestId),
            getResearchArtifacts: (requestId: string) => dataServices.repositories.researchArtifactRepository.listArtifactsByRequest(requestId),
            getResearchRequest: (requestId: string) => dataServices.repositories.researchArtifactRepository.getRequestById(requestId),
            getRiskProfile: () => riskProfileService.get(),
            listResearchRequests: (query?: ResearchRequestListQuery) => dataServices.repositories.researchArtifactRepository.listRequestSummaries(query),
            saveRiskProfile: (profile: RiskProfileSnapshot) => riskProfileService.save(validateRiskProfileSnapshot(profile)),
            startResearch: async (request: ResearchRequestInput) => runner.startResearch(validateResearchRequestInput(request)),
            subscribe: (listener: Parameters<ResearchDirector['subscribe']>[0]) => runner.subscribe(listener),
        };
    }

    const resolvedDirector = director ?? new ResearchDirector({
        eventBus,
        executorFactory: async () => await resolveResearchExecutor({ piRuntime, riskGatePreferences, researchRuntimeMode: resolvedMode }),
        marketDataResolver,
        priceProviderIds: (asset) => getPriceProviderOrder({ market: asset.market, symbol: asset.symbol }),
        repositories: dataServices.repositories,
        repository: dataServices.repositories.researchArtifactRepository,
        riskProfileService,
    });

    return {
        cancelResearch: (requestId: string) => resolvedDirector.cancelResearch(requestId),
        getResearchArtifacts: (requestId: string) => dataServices.repositories.researchArtifactRepository.listArtifactsByRequest(requestId),
        getResearchRequest: (requestId: string) => dataServices.repositories.researchArtifactRepository.getRequestById(requestId),
        getRiskProfile: () => riskProfileService.get(),
        listResearchRequests: (query?: ResearchRequestListQuery) => dataServices.repositories.researchArtifactRepository.listRequestSummaries(query),
        saveRiskProfile: (profile: RiskProfileSnapshot) => riskProfileService.save(validateRiskProfileSnapshot(profile)),
        startResearch: async (request: ResearchRequestInput) => {
            return resolvedDirector.startResearch(validateResearchRequestInput(request));
        },
        subscribe: (listener: Parameters<ResearchDirector['subscribe']>[0]) => resolvedDirector.subscribe(listener),
    };
};

export const registerResearchIpc = (
    binder: ContractBinder,
    dataServices: DataServices,
    marketDataResolver?: Pick<MarketDataPublicApi, 'ensure' | 'lookup'>,
    piRuntime?: PiResearchRuntime,
    riskGatePreferences?: PiRiskGatePreferences,
) => {
    const handlers = createResearchHandlers({ dataServices, marketDataResolver, piRuntime, riskGatePreferences });

    binder.bindSubscription('research', 'onResearchStream', (listener) => handlers.subscribe(listener));
    binder.registerInvokeNamespace('research', {
        cancelResearch: handlers.cancelResearch,
        getResearchArtifacts: handlers.getResearchArtifacts,
        getResearchRequest: handlers.getResearchRequest,
        getRiskProfile: handlers.getRiskProfile,
        listResearchRequests: handlers.listResearchRequests,
        saveRiskProfile: handlers.saveRiskProfile,
        startResearch: handlers.startResearch,
    });
};