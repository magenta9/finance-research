import type { Currency, DailyPriceRecord, FxRateRecord, StoredAsset } from '@quantdesk/shared';

import type { Repositories } from '../db/repositories';
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
    private readonly repositories: Pick<Repositories, 'assetRepository' | 'fxRateRepository' | 'priceRepository'>;

    constructor(repositories: Pick<Repositories, 'assetRepository' | 'fxRateRepository' | 'priceRepository'>) {
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
        const directPair = `${assetCurrency}/${baseCurrency}`;
        const inversePair = `${baseCurrency}/${assetCurrency}`;
        const directRate = this.repositories.fxRateRepository.getLatestRate(directPair, onOrBeforeDate);

        if (directRate) {
            return {
                ...directRate,
                pair: directPair,
            };
        }

        const inverseRate = this.repositories.fxRateRepository.getLatestRate(inversePair, onOrBeforeDate);
        if (!inverseRate) {
            return null;
        }

        return {
            date: inverseRate.date,
            pair: inversePair,
            rate: 1 / inverseRate.rate,
            source: inverseRate.source,
        } satisfies FxRateRecord & { pair: string };
    }

    readPreparationContext({ assetIds, endDate, startDate }: { assetIds: string[]; endDate?: string; startDate?: string; }) {
        return {
            assets: this.readAssets(assetIds),
            requestedEndDate: endDate,
            requestedStartDate: startDate,
        };
    }
}