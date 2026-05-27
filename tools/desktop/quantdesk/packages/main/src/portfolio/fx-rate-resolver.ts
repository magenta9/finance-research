import type { Currency, FxRateRecord } from '@quantdesk/shared';

export interface FxRateResolverInput {
    assetCurrency: Currency;
    baseCurrency: Currency;
    onOrBeforeDate: string;
}

export interface FxRateRepositoryReader {
    getLatestRate(pair: string, onOrBeforeDate: string): FxRateRecord | null;
}

export interface FxRateResolver {
    resolve(input: FxRateResolverInput): FxRateRecord | null;
}

export class DirectInverseFxRateResolver implements FxRateResolver {
    private readonly repository: FxRateRepositoryReader;

    constructor(repository: FxRateRepositoryReader) {
        this.repository = repository;
    }

    resolve({
        assetCurrency,
        baseCurrency,
        onOrBeforeDate,
    }: FxRateResolverInput): FxRateRecord | null {
        if (assetCurrency === baseCurrency) {
            return {
                date: onOrBeforeDate,
                pair: `${assetCurrency}/${baseCurrency}`,
                rate: 1,
                source: 'identity',
            };
        }

        const directPair = `${assetCurrency}/${baseCurrency}`;
        const directRate = this.repository.getLatestRate(directPair, onOrBeforeDate);

        if (directRate) {
            return directRate;
        }

        const inversePair = `${baseCurrency}/${assetCurrency}`;
        const inverseRate = this.repository.getLatestRate(inversePair, onOrBeforeDate);
        if (!inverseRate) {
            return null;
        }

        return {
            date: inverseRate.date,
            pair: inversePair,
            rate: 1 / inverseRate.rate,
            source: inverseRate.source,
        };
    }
}
