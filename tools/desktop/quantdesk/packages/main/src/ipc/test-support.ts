import { vi } from 'vitest';

import type { DataServices } from '../db/services';
import { preferenceKeys } from '../preferences/preference-keys';
import type { RegisterIpcRuntime } from './register';

class MemorySecretStore {
    async get() {
        return null;
    }

    async set() {
        return undefined;
    }

    async delete() {
        return undefined;
    }
}

type StubPriceSyncService = Pick<
    NonNullable<NonNullable<NonNullable<RegisterIpcRuntime['marketData']>['services']>['priceSyncService']>,
    'subscribeSyncStatus'
>;
type RuntimePriceSyncService = NonNullable<RegisterIpcRuntime['marketData']>['services']['priceSyncService'];

export interface CreateStubRegisterIpcRuntimeOptions extends Partial<RegisterIpcRuntime> {
    priceSyncService?: StubPriceSyncService;
}

const createDefaultMarketDataRuntime = (): NonNullable<RegisterIpcRuntime['marketData']> => ({
    orchestrator: {
        ensure: vi.fn(async () => ({
            intent: 'asset-history' as const,
            syncStatus: {
                activeTask: null,
                completedTasks: 0,
                failedTasks: 0,
                lastWarning: null,
                queuedTasks: 0,
                recentEvents: [],
                running: false,
            },
            warnings: [],
        })),
        lookup: vi.fn(async () => []),
    },
    services: {
        cacheService: {
            clearCache: vi.fn(),
            getCacheSummary: vi.fn(),
        } as never,
        csvImportService: {
            importAssetsCsv: vi.fn(),
            importPositionsCsv: vi.fn(),
            importPricesCsv: vi.fn(),
        } as never,
        metadataBackfillService: {
            getMetadataBackfillStatus: vi.fn(),
        } as never,
        priceSyncService: {
            getSyncStatus: vi.fn(),
            subscribeSyncStatus: vi.fn(),
            syncFxRates: vi.fn(),
            syncPrices: vi.fn(),
        } as never,
    },
    sidecarRuntime: {
        snapshot: vi.fn(() => ({
            endpoint: null,
            healthy: false,
            lastDiagnostic: null,
            lastError: null,
            pid: null,
            restartCount: 0,
            state: 'idle' as const,
        })),
    },
});

const mergeMarketDataRuntime = (
    marketData?: RegisterIpcRuntime['marketData'],
    priceSyncService?: StubPriceSyncService,
): NonNullable<RegisterIpcRuntime['marketData']> => {
    const defaults = createDefaultMarketDataRuntime();
    const priceSyncDefaults = defaults.services.priceSyncService;
    const priceSyncOverride = marketData?.services.priceSyncService;

    return {
        ...defaults,
        ...marketData,
        orchestrator: marketData?.orchestrator ?? defaults.orchestrator,
        services: {
            ...defaults.services,
            ...marketData?.services,
            priceSyncService: {
                ...priceSyncDefaults,
                ...priceSyncOverride,
                ...priceSyncService,
            } as RuntimePriceSyncService,
        },
        sidecarRuntime: marketData?.sidecarRuntime ?? defaults.sidecarRuntime,
    };
};

export const createStubRegisterIpcRuntime = ({
    priceSyncService,
    marketData,
    ...runtime
}: CreateStubRegisterIpcRuntimeOptions = {}): RegisterIpcRuntime => ({
    ...runtime,
    marketData: mergeMarketDataRuntime(marketData, priceSyncService),
});

export const createStubDataServices = ({
    baseCurrency = null,
}: {
    baseCurrency?: string | null;
} = {}): DataServices => ({
    repositories: {
        allocationPlanRepository: {
            delete: vi.fn(() => false),
            list: vi.fn(() => []),
            save: vi.fn((input) => input),
        },
        assetRepository: {
            create: vi.fn((input) => ({
                ...input,
                createdAt: '2026-04-11T00:00:00.000Z',
                updatedAt: '2026-04-11T00:00:00.000Z',
            })),
            delete: vi.fn(() => false),
            list: vi.fn(() => []),
            search: vi.fn(() => []),
            update: vi.fn((input) => ({
                ...input,
                createdAt: '2026-04-11T00:00:00.000Z',
                updatedAt: '2026-04-11T00:00:00.000Z',
            })),
        },
        conversationRepository: {
            appendMessage: vi.fn(),
            create: vi.fn(),
            delete: vi.fn(() => false),
            getById: vi.fn(() => null),
            list: vi.fn(() => []),
        },
        fxRateRepository: {
            clearAll: vi.fn(),
            count: vi.fn(() => 0),
            getLatestRate: vi.fn(() => null),
        },
        positionRepository: {
            delete: vi.fn(() => false),
            listByPortfolio: vi.fn(() => []),
            save: vi.fn((input) => input),
        },
        preferencesRepository: {
            delete: vi.fn(() => false),
            get: vi.fn((key: string) => key === preferenceKeys.baseCurrency ? baseCurrency : null),
            getAll: vi.fn(() => baseCurrency ? { [preferenceKeys.baseCurrency]: baseCurrency } : {}),
            set: vi.fn((_key, value) => value),
        },
        priceRepository: {
            clearAll: vi.fn(),
            count: vi.fn(() => 0),
            getLatestFetchedAt: vi.fn(() => null),
            countByAssetId: vi.fn(() => 0),
            getDateBounds: vi.fn(() => ({ earliestDate: null, latestDate: null })),
            getRange: vi.fn(() => []),
            listByAsset: vi.fn(() => []),
        },
    },
    secretStore: new MemorySecretStore(),
}) as unknown as DataServices;