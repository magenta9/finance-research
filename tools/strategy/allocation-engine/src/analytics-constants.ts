import type { Currency } from '@quantdesk/shared';

export const annualizationFactor = 252;

export const riskFreeRates: Record<Currency, number> = {
    CNY: 0.02,
    HKD: 0.04,
    USD: 0.04,
};

export const minTradingDaysForRiskMetrics = 126;

export const adjustedCloseFallbackThreshold = 0.1;