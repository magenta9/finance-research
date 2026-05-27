import type { Currency } from '../domain';

export interface PositionInput {
    id: string;
    portfolioName?: string;
    assetId: string;
    shares: number;
    costBasis: number | null;
    currency: Currency;
}

export interface PositionRecord extends Required<PositionInput> {
    updatedAt: string;
}