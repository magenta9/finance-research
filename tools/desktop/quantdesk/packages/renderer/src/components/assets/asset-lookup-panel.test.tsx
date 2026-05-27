// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import type { AssetLookupResult } from '@quantdesk/shared';

import { AssetLookupPanel } from './asset-lookup-panel';

const baseCandidate: AssetLookupResult = {
    assetClass: 'equity',
    currency: 'CNY',
    market: 'A',
    metadata: {
        issueDate: '2020-01-02',
        issueDateSource: 'akshare-xq',
    },
    name: '纳斯达克100ETF',
    source: 'akshare',
    symbol: '159941',
};

describe('AssetLookupPanel', () => {
    test('renders issue date from candidate metadata', () => {
        render(
            <AssetLookupPanel
                assets={[]}
                isLoading={false}
                lookupMarket="ALL"
                lookupQuery="159941"
                onAdd={vi.fn()}
                onLookup={vi.fn()}
                onLookupMarketChange={vi.fn()}
                onLookupQueryChange={vi.fn()}
                results={[baseCandidate]}
            />,
        );

        expect(screen.getByText('发行日期 2020-01-02')).toBeInTheDocument();
        expect(screen.getByText('纳斯达克100ETF')).toBeInTheDocument();
    });

    test('renders fallback text when issue date is unavailable', () => {
        render(
            <AssetLookupPanel
                assets={[]}
                isLoading={false}
                lookupMarket="ALL"
                lookupQuery="SPY"
                onAdd={vi.fn()}
                onLookup={vi.fn()}
                onLookupMarketChange={vi.fn()}
                onLookupQueryChange={vi.fn()}
                results={[{ ...baseCandidate, metadata: {}, symbol: 'SPY', market: 'US', currency: 'USD', name: 'SPDR S&P 500 ETF Trust' }]}
            />,
        );

        expect(screen.getByText('发行日期 未提供')).toBeInTheDocument();
    });

    test('renders futures contract metadata instead of issue date', () => {
        render(
            <AssetLookupPanel
                assets={[]}
                isLoading={false}
                lookupMarket="COMMODITY"
                lookupQuery="RB"
                onAdd={vi.fn()}
                onLookup={vi.fn()}
                onLookupMarketChange={vi.fn()}
                onLookupQueryChange={vi.fn()}
                results={[{
                    assetClass: 'commodity',
                    currency: 'CNY',
                    exchange: 'SHFE',
                    market: 'COMMODITY',
                    metadata: {
                        contractType: 'dominant_continuous',
                        exchange: 'SHFE',
                        instrumentType: 'futures',
                        seriesAdjustment: 'raw_main_continuous',
                        tsCode: 'RB.SHF',
                        tsCodeAsset: 'FT',
                        underlyingSymbol: 'RB',
                    },
                    name: '螺纹钢主连',
                    source: 'tushare',
                    symbol: 'RB9999',
                }]}
            />,
        );

        expect(screen.getByText('商品期货主力 / SHFE / TuShare / 原始主力连续')).toBeInTheDocument();
        expect(screen.getByText('RB')).toBeInTheDocument();
    });
});