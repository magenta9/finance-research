import type { BaseCurrencyConfig } from './types/domain';

export const APP_NAME = 'QuantDesk';

export const DEFAULT_BASE_CURRENCY_CONFIG: BaseCurrencyConfig = {
  baseCurrency: 'CNY',
  supportedCurrencies: ['CNY', 'HKD', 'USD'],
};
