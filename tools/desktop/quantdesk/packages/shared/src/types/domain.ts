export type Currency = 'CNY' | 'HKD' | 'USD';

export type Market = 'A' | 'HK' | 'US' | 'BOND' | 'COMMODITY';

export type AssetClass =
  | 'equity'
  | 'fixed_income'
  | 'commodity'
  | 'alternative'
  | 'cash';

export type AllocationType = 'erc' | 'inverse_volatility' | 'max_diversification';

export type AllocationStrategy =
  | AllocationType
  | 'max_diversification_research_v1'
  | 'ewmac_trend_following'
  | 'active_dual_momentum_gtaa';

export type RebalanceCadence = 'none' | 'weekly' | 'monthly' | 'quarterly';

export interface EwmacRuleConfig {
  enabled?: boolean;
  fast: number;
  slow?: number;
  scalar?: number;
  weight?: number;
}

export interface ActiveDualMomentumStrategyConfig {
  absoluteMomentumFilter?: boolean;
  longLookbackWeeks?: number;
  shortLookbackWeeks?: number;
  slippageBps?: number;
  sleeveWeights?: { long: number; short: number };
  topK?: number;
  transactionCostBps?: number;
}

export interface MaxDiversificationStrategyConfig {
  absoluteMomentumLookbackDaysList?: number[];
  absoluteMomentumMinPositiveCount?: number;
  absoluteMomentumThreshold?: number;
  cashReserve?: number;
  diagonalLoad?: number;
  commodityClassWeightCap?: number;
  equityClassWeightCap?: number;
  fixedIncomeClassWeightCap?: number;
  marchenkoPasturDenoise?: boolean;
  maxSingleWeight?: number;
  maxTrackingErrorVolatility?: number;
  momentumReturnTiltStrength?: number;
  portfolioVolatilityCapAnnualized?: number;
  portfolioVolatilityCapMinRiskyScale?: number;
  equalWeightShrinkageIntensity?: number;
  semiCovarianceForOptimization?: boolean;
  mdErcBlendWeight?: number;
  minCorrelation?: number;
  momentumBreadthCashScale?: number;
  volatilityPower?: number;
}

export interface TrendFollowingStrategyConfig {
  enabled: boolean;
  sleeveWeight: number;
  allowShort?: boolean;
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
  activeDualMomentum?: ActiveDualMomentumStrategyConfig;
  allocation?: AllocationSleeveStrategyConfig;
  maxDiversification?: MaxDiversificationStrategyConfig;
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
  direction?: 'long' | 'short';
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
  action: 'open_long' | 'close_long' | 'open_short' | 'close_short';
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

export interface ActiveDualMomentumCashBreakdown {
  explicit: {
    correlatedSameDirectionDedup: number;
    crossSignOffset: number;
    riskExitCooldown: number;
    riskTrimCooldown: number;
    sameAssetSleeveDedup: number;
    sleeveFilter: number;
    standingBuffer: number;
    total: number;
  };
  residual: number;
  resolvedTotal: number;
}

export interface ActiveDualMomentumProcessorTrace {
  cashWeight: number;
  changedPositionCount: number;
  id:
  | 'correlated-same-direction-dedup'
  | 'cross-sign-offset-cash'
  | 'risk-exit-redeployment-cooldown'
  | 'risk-trim-redeployment-cooldown'
  | 'rebalance-smoothing';
  inputGrossWeight: number;
  outputGrossWeight: number;
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

export interface ActiveDualMomentumDiagnostics {
  averageNetExposure: number;
  averageNominalExposure: number;
  calmarRatio?: number;
  cashWeight: number;
  maxNetExposure: number;
  maxNominalExposure: number;
  rebalanceRecords: Array<{
    cashWeight: number;
    cashBreakdown?: ActiveDualMomentumCashBreakdown;
    date: string;
    holdings: Array<{
      assetId: string;
      direction: 'long' | 'short';
      longMomentum?: number;
      shortMomentum?: number;
      source: 'short' | 'long' | 'both';
      symbol: string;
      weight: number;
    }>;
    selectedButFiltered: Array<{
      assetId: string;
      momentum: number;
      reason: 'NEGATIVE_MOMENTUM';
      symbol: string;
    }>;
    processorTrace?: ActiveDualMomentumProcessorTrace[];
  }>;
  status: 'ok' | 'degraded' | 'unavailable';
  totalCost?: number;
  turnover: number;
  winRate?: number;
}

export interface AllocationDiagnostics {
  strategy?: AllocationStrategy;
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
  activeDualMomentum?: ActiveDualMomentumDiagnostics;
  trades?: AllocationTrade[];
  strategyMix?: {
    allocationSleeveWeight: number;
    allocation?: {
      assetIds: string[];
    };
    trendFollowing?: {
      enabled: boolean;
      sleeveWeight: number;
      allowShort: boolean;
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
      activeLongRules: number;
      activeRuleCount: number;
      activeShortRules: number;
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
  strategy?: AllocationStrategy;
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
