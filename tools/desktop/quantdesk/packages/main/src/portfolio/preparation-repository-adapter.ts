import type { Currency, DailyPriceRecord, FxRateRecord, StoredAsset } from '@quantdesk/shared';

import type { Repositories } from '../db/repositories';
import { DirectInverseFxRateResolver, type FxRateResolver } from './fx-rate-resolver';
import { AllocationPreparationError } from './preparation-errors';

export interface AllocationPreparationContext {
    assets: StoredAsset[];
    requestedEndDate?: string;
    requestedStartDate?: string;
}

export interface AllocationPreparationReader {
    readAssets: (assetIds: string[]) => StoredAsset[];
    readPriceHistory: (query: {
        assetId: string;
        startDate?: string;
        endDate?: string;
    }) => DailyPriceRecord[];
    readFxRates: (query: {
        assetCurrency: Currency;
        baseCurrency: Currency;
        onOrBeforeDate: string;
    }) => (FxRateRecord & { pair: string }) | null;
    readPreparationContext: (query: {
        assetIds: string[];
        startDate?: string;
        endDate?: string;
    }) => AllocationPreparationContext;
}

export class PreparationRepositoryAdapter implements AllocationPreparationReader {
    private readonly fxRateResolver: FxRateResolver;

    private readonly repositories: Pick<Repositories, 'assetRepository' | 'fxRateRepository' | 'priceRepository'>;

    constructor(
        repositories: Pick<Repositories, 'assetRepository' | 'fxRateRepository' | 'priceRepository'>,
        fxRateResolver: FxRateResolver = new DirectInverseFxRateResolver(repositories.fxRateRepository),
    ) {
        this.fxRateResolver = fxRateResolver;
        this.repositories = repositories;
    }

    readAssets(assetIds: string[]) {
        const assetIdSet = new Set(assetIds);
        return this.repositories.assetRepository.list().filter((asset) => assetIdSet.has(asset.id));
    }

    readPriceHistory({ assetId, endDate, startDate }: { assetId: string; endDate?: string; startDate?: string; }) {
        if (startDate && endDate) {
            return this.repositories.priceRepository.getRange({
                assetId,
                endDate,
                startDate,
            });
        }

        if (startDate || endDate) {
            throw new AllocationPreparationError({
                code: 'INVALID_DATE_RANGE',
                message: 'Price history range queries require both startDate and endDate.',
                suggestions: ['Provide both startDate and endDate, or omit both to read full asset history.'],
            });
        }

        return this.repositories.priceRepository.listByAsset(assetId);
    }

    readFxRates({
        assetCurrency,
        baseCurrency,
        onOrBeforeDate,
    }: {
        assetCurrency: Currency;
        baseCurrency: Currency;
        onOrBeforeDate: string;
    }) {
        return this.fxRateResolver.resolve({
            assetCurrency,
            baseCurrency,
            onOrBeforeDate,
        });
    }

    readPreparationContext({ assetIds, endDate, startDate }: { assetIds: string[]; endDate?: string; startDate?: string; }) {
        return {
            assets: this.readAssets(assetIds),
            requestedEndDate: endDate,
            requestedStartDate: startDate,
        };
    }
}