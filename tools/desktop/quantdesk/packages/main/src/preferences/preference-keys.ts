export const preferenceKeys = {
  assetUniverse: {
    defaultLocalAssetSeedVersion: 'assetUniverse.defaultLocalAssetSeedVersion',
  },
  baseCurrency: 'baseCurrency',
  dataSource: {
    akshareEnabled: 'dataSource.akshare.enabled',
    frankfurterEnabled: 'dataSource.frankfurter.enabled',
    tushareEnabled: 'dataSource.tushare.enabled',
    yfinanceEnabled: 'dataSource.yfinance.enabled',
  },
  piAgent: {
    highPrivilegeRiskAcknowledged: 'piAgent.highPrivilegeRiskAcknowledged',
    highPrivilegeRiskAcknowledgedAt: 'piAgent.highPrivilegeRiskAcknowledgedAt',
  },
} as const;
