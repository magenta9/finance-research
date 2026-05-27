import type { AllocationTrade } from '@quantdesk/shared';

import { minimumPortfolioTradeWeight } from './portfolio-constants';

export interface AllocationTradeSource {
    trades: AllocationTrade[];
    weightScale?: number;
}

export interface AggregateAllocationTradeSourcesInput {
    minimumWeightChange?: number;
    sources: AllocationTradeSource[];
}

export const isMaterialAllocationTradeChange = (
    weightChange: number,
    minimumWeightChange = minimumPortfolioTradeWeight,
) => Math.abs(weightChange) >= minimumWeightChange;

export const scaleAllocationTrade = (trade: AllocationTrade, scale: number): AllocationTrade => ({
    ...trade,
    fromWeight: trade.fromWeight * scale,
    toWeight: trade.toWeight * scale,
    weightChange: trade.weightChange * scale,
});

export const aggregateAllocationTradeSources = ({
    minimumWeightChange = minimumPortfolioTradeWeight,
    sources,
}: AggregateAllocationTradeSourcesInput): AllocationTrade[] => sources
    .flatMap(({ trades, weightScale = 1 }) => trades.map((trade) =>
        weightScale === 1 ? trade : scaleAllocationTrade(trade, weightScale)))
    .filter((trade) => isMaterialAllocationTradeChange(trade.weightChange, minimumWeightChange));
