export type Currency = 'CNY' | 'HKD' | 'USD';

export type Market = 'A' | 'HK' | 'US' | 'BOND' | 'COMMODITY';

export type AssetClass =
  | 'equity'
  | 'fixed_income'
  | 'commodity'
  | 'alternative'
  | 'cash';

export type AllocationType = 'erc' | 'inverse_volatility' | 'max_diversification';

export type RebalanceCadence = 'none' | 'monthly' | 'quarterly';

export interface EwmacRuleConfig {
  enabled?: boolean;
  fast: number;
  slow?: number;
  scalar?: number;
  weight?: number;
}

export interface TrendFollowingStrategyConfig {
  enabled: boolean;
  sleeveWeight: number;
  assetIds?: string[];
  forecastCap?: number;
  forecastDiversificationMultiplier?: number;
  rules?: EwmacRuleConfig[];
  volatilitySpan?: number;
}

export interface AllocationSleeveStrategyConfig {
  assetIds?: string[];
}

export interface AllocationStrategyMix {
  allocation?: AllocationSleeveStrategyConfig;
  trendFollowing?: TrendFollowingStrategyConfig;
}

export interface Constraint {
  key: string;
  label: string;
  value: boolean | number | string | Record<string, number>;
}

export interface Asset {
  id: string;
  symbol: string;
  name: string;
  market: Market;
  assetClass: AssetClass;
  currency: Currency;
  tags: string[];
  metadata?: Record<string, unknown>;
}

export interface BaseCurrencyConfig {
  baseCurrency: Currency;
  supportedCurrencies: Currency[];
}

export interface AllocationConstraints {
  maxSingleWeight: number;
  maxClassWeight: Partial<Record<AssetClass, number>>;
  allowLeverage: boolean;
  allowShort: boolean;
}

export interface AllocationAssetWeight {
  assetId: string;
  symbol: string;
  name: string;
  market: Market;
  assetClass: AssetClass;
  currency: Currency;
  weight: number;
  riskContribution: number;
  annualizedReturn: number;
  annualizedVolatility: number;
}

export interface CorrelationMatrix {
  labels: string[];
  matrix: number[][];
}

export interface ScenarioAnalysis {
  name: string;
  estimatedReturn: number;
  estimatedDrawdown: number;
  riskFactors: string[];
}

export interface PortfolioMetrics {
  expectedReturn: number;
  volatility: number;
  sharpeRatio: number;
  maxDrawdown: number;
}

export interface PortfolioPathPoint {
  date: string;
  equity: number;
  allocationEquity?: number;
  trendFollowingEquity?: number;
}

export interface AllocationTrade {
  date: string;
  assetId: string;
  symbol: string;
  name: string;
  source: 'allocation' | 'trend_following';
  action: 'buy' | 'sell';
  fromWeight: number;
  toWeight: number;
  weightChange: number;
  reason: string;
}

export interface ErcDiagnostics {
  converged: boolean;
  iterations: number;
  maxContributionGap: number;
  convergenceWarning: boolean;
}

export interface AssetDateCoverage {
  assetId: string;
  symbol: string;
  requestedStartDate: string;
  actualStartDate: string;
  actualEndDate: string;
  tradingDays: number;
  isFallback: boolean;
}

export interface AllocationDiagnostics {
  optimizer: 'js' | 'python';
  alignedDates: number;
  excludedAssets: string[];
  warnings: string[];
  metricComputation?: 'portfolio_path_simulation';
  rebalanceEventCount?: number;
  dateRange?: { startDate: string; endDate: string };
  assetDateCoverage?: AssetDateCoverage[];
  solverPath?: 'js' | 'python';
  fallbackUsed?: boolean;
  fallbackReason?: 'erc_non_converged' | 'singular_matrix' | 'invalid_volatility' | 'unsupported_constraints';
  fallbackEquivalentMode?: 'inverse_volatility' | 'equal_weight';
  erc?: ErcDiagnostics;
  trades?: AllocationTrade[];
  strategyMix?: {
    allocationSleeveWeight: number;
    allocation?: {
      assetIds: string[];
    };
    trendFollowing?: {
      enabled: boolean;
      sleeveWeight: number;
      assetIds?: string[];
      forecastCap: number;
      forecastDiversificationMultiplier: number;
      ruleSlotCount: number;
      rules: Array<{
        fast: number;
        slow: number;
        scalar: number;
        weight: number;
      }>;
    };
  };
  trendFollowing?: {
    assets: Array<{
      assetId: string;
      symbol: string;
      activeRuleCount: number;
      averageAbsForecast: number;
      latestForecast: number;
      latestPositionWeight: number;
    }>;
  };
}

export interface AllocationError {
  code: string;
  message: string;
  suggestions: string[];
}

export interface AllocationResult {
  mode: AllocationType;
  rebalanceCadence: RebalanceCadence;
  baseCurrency: Currency;
  generatedAt: string;
  weights: Record<string, number>;
  allocations: AllocationAssetWeight[];
  riskContributions: Record<string, number>;
  portfolioMetrics: PortfolioMetrics;
  portfolioPath?: PortfolioPathPoint[];
  scenarioAnalysis: ScenarioAnalysis[];
  correlationMatrix: CorrelationMatrix;
  diagnostics: AllocationDiagnostics;
  diversificationRatio?: number;
  error?: AllocationError;
}
