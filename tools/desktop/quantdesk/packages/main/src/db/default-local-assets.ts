import type { AssetInput } from '@quantdesk/shared';

import { preferenceKeys } from '../preferences/preference-keys';
import type { Repositories } from './repositories';

export const defaultLocalAssetSeedVersion =
  '2026-05-a-share-index-etf-hk-index-v4';

const buildDefaultAsset = (
  symbol: string,
  name: string,
  benchmark: string,
  exchange: 'SSE' | 'SZSE',
  tags: string[],
): AssetInput => ({
  id: `seed-a-etf-${symbol}`,
  symbol,
  name,
  market: 'A',
  assetClass: 'equity',
  currency: 'CNY',
  tags: ['default-local-universe', 'a-share-index-etf', benchmark, ...tags],
  metadata: {
    benchmark,
    exchange,
    seedPack: defaultLocalAssetSeedVersion,
  },
});

const buildDefaultHangSengEtfAsset = (
  symbol: string,
  name: string,
  benchmark: string,
  exchange: 'SSE' | 'SZSE',
  tags: string[],
): AssetInput => ({
  ...buildDefaultAsset(symbol, name, benchmark, exchange, [
    'hang-seng',
    'hong-kong',
    ...tags,
  ]),
  metadata: {
    benchmark,
    exchange,
    seedPack: defaultLocalAssetSeedVersion,
    underlyingMarket: 'HK',
  },
});

const buildDefaultHkIndexAsset = (
  id: string,
  symbol: string,
  name: string,
  benchmark: string,
  tags: string[],
): AssetInput => ({
  id: `seed-hk-index-${id}`,
  symbol,
  name,
  market: 'HK',
  assetClass: 'equity',
  currency: 'HKD',
  tags: ['default-local-universe', 'hk-index', benchmark, ...tags],
  metadata: {
    benchmark,
    exchange: 'HKEX',
    instrumentType: 'index',
    priceProvider: 'yfinance',
    seedPack: defaultLocalAssetSeedVersion,
  },
});

export const DEFAULT_LOCAL_ASSETS: AssetInput[] = [
  buildDefaultAsset('510300', '沪深300ETF', '沪深300', 'SSE', [
    'broad-market',
    'large-cap',
  ]),
  buildDefaultAsset('510050', '上证50ETF', '上证50', 'SSE', [
    'broad-market',
    'large-cap',
    'value',
  ]),
  buildDefaultAsset('510500', '中证500ETF', '中证500', 'SSE', [
    'broad-market',
    'mid-cap',
  ]),
  buildDefaultAsset('512100', '中证1000ETF', '中证1000', 'SSE', [
    'broad-market',
    'small-cap',
  ]),
  buildDefaultAsset('159593', '中证A50ETF', '中证A50', 'SZSE', [
    'broad-market',
    'large-cap',
    'core',
  ]),
  buildDefaultAsset('159901', '深证100ETF', '深证100', 'SZSE', [
    'broad-market',
    'szse',
    'large-cap',
  ]),
  buildDefaultAsset('159915', '创业板ETF', '创业板指', 'SZSE', [
    'growth',
    'innovation',
  ]),
  buildDefaultAsset('159949', '创业板50ETF', '创业板50', 'SZSE', [
    'growth',
    'innovation',
    'concentrated',
  ]),
  buildDefaultAsset('588000', '科创50ETF', '科创50', 'SSE', [
    'technology',
    'innovation',
    'star-market',
  ]),
  buildDefaultAsset('515180', '红利ETF', '中证红利', 'SSE', [
    'dividend',
    'style',
  ]),
  buildDefaultAsset('159209', '红利质量ETF', '中证全指红利质量', 'SZSE', [
    'dividend',
    'quality',
    'style',
  ]),
  buildDefaultAsset('512890', '红利低波ETF', '中证红利低波动', 'SSE', [
    'dividend',
    'low-volatility',
    'style',
  ]),
  buildDefaultAsset('159201', '自由现金流ETF', '国证自由现金流', 'SZSE', [
    'cash-flow',
    'quality',
    'style',
  ]),
  buildDefaultAsset('561580', '央企红利ETF', '央企红利', 'SSE', [
    'dividend',
    'state-owned',
    'style',
  ]),
  buildDefaultAsset('159928', '消费ETF', '中证主要消费', 'SZSE', [
    'consumer',
    'sector',
  ]),
  buildDefaultAsset('159996', '家电ETF', '家电', 'SZSE', [
    'consumer',
    'sector',
    'appliance',
  ]),
  buildDefaultAsset('515170', '食品饮料ETF', '食品饮料', 'SSE', [
    'consumer',
    'sector',
    'food-beverage',
  ]),
  buildDefaultAsset('512800', '银行ETF', '中证银行', 'SSE', [
    'financials',
    'sector',
    'bank',
  ]),
  buildDefaultAsset('512980', '传媒ETF', '中证传媒', 'SSE', [
    'media',
    'sector',
  ]),
  buildDefaultAsset('512880', '证券ETF', '中证全指证券公司', 'SSE', [
    'financials',
    'sector',
    'brokerage',
  ]),
  buildDefaultAsset('512010', '医药ETF', '沪深300医药卫生', 'SSE', [
    'healthcare',
    'sector',
    'pharma',
  ]),
  buildDefaultAsset('159583', '通信ETF', '通信', 'SZSE', [
    'technology',
    'sector',
    'communication',
  ]),
  buildDefaultAsset('512480', '半导体ETF', '中证全指半导体', 'SSE', [
    'technology',
    'sector',
    'semiconductor',
  ]),
  buildDefaultAsset('159857', '光伏ETF', '光伏', 'SZSE', [
    'technology',
    'sector',
    'solar',
  ]),
  buildDefaultAsset('516160', '新能源ETF', '新能源', 'SSE', [
    'technology',
    'sector',
    'new-energy',
  ]),
  buildDefaultAsset('159819', '人工智能ETF', '人工智能', 'SZSE', [
    'technology',
    'sector',
    'ai',
  ]),
  buildDefaultAsset('159272', '机器人ETF', '机器人', 'SZSE', [
    'technology',
    'sector',
    'robotics',
  ]),
  buildDefaultHangSengEtfAsset('513180', '恒生科技ETF', '恒生科技指数', 'SSE', [
    'technology',
    'sector',
  ]),
  buildDefaultHangSengEtfAsset('513970', '恒生消费ETF', '恒生消费指数', 'SSE', [
    'consumer',
    'sector',
  ]),
  buildDefaultHangSengEtfAsset(
    '513060',
    '恒生医疗ETF',
    '恒生医疗保健指数',
    'SSE',
    ['healthcare', 'sector'],
  ),
  buildDefaultHangSengEtfAsset(
    '513330',
    '恒生互联网ETF',
    '恒生互联网科技业指数',
    'SSE',
    ['internet', 'technology', 'sector'],
  ),
  buildDefaultHkIndexAsset('hsi', '^HSI', '恒生指数', '恒生指数', [
    'broad-market',
    'hong-kong',
  ]),
  buildDefaultHkIndexAsset(
    'hstech',
    '^HSTECH',
    '恒生科技指数',
    '恒生科技指数',
    ['technology', 'hong-kong'],
  ),
];

export const seedDefaultLocalAssets = ({
  assetRepository,
  preferencesRepository,
}: Pick<Repositories, 'assetRepository' | 'preferencesRepository'>) => {
  const appliedVersion = preferencesRepository.get(
    preferenceKeys.assetUniverse.defaultLocalAssetSeedVersion,
  );

  if (appliedVersion === defaultLocalAssetSeedVersion) {
    return {
      applied: false,
      insertedCount: 0,
    };
  }

  const existingKeys = new Set(
    assetRepository.list().map((asset) => `${asset.market}:${asset.symbol}`),
  );

  const missingAssets = DEFAULT_LOCAL_ASSETS.filter(
    (asset) => !existingKeys.has(`${asset.market}:${asset.symbol}`),
  );

  if (missingAssets.length > 0) {
    assetRepository.createMany(missingAssets);
  }

  preferencesRepository.set(
    preferenceKeys.assetUniverse.defaultLocalAssetSeedVersion,
    defaultLocalAssetSeedVersion,
  );

  return {
    applied: true,
    insertedCount: missingAssets.length,
  };
};
