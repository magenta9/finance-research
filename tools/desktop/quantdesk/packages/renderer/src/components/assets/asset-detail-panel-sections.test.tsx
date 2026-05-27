// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import { AssetMetadataSection } from './asset-detail-panel-sections';

describe('AssetMetadataSection', () => {
    test('renders futures source and adjustment metadata', () => {
        render(
            <AssetMetadataSection
                assetMetadata={{
                    contractType: 'dominant_continuous',
                    exchange: 'SHFE',
                    instrumentType: 'futures',
                    priceSeriesSource: 'tushare-futures',
                    seriesAdjustment: 'raw_main_continuous',
                    tsCode: 'RB.SHF',
                    underlyingSymbol: 'RB',
                }}
                coverageLabel="2026-01-02 - 2026-01-05"
                createdAt="2026-01-01 00:00:00"
                updatedAt="2026-01-06 00:00:00"
            />,
        );

        expect(screen.getByText('合约类型')).toBeInTheDocument();
        expect(screen.getByText('商品期货主力')).toBeInTheDocument();
        expect(screen.getByText('价格口径')).toBeInTheDocument();
        expect(screen.getByText('原始主力连续，未做换月调整')).toBeInTheDocument();
        expect(screen.getByText('tushare-futures')).toBeInTheDocument();
    });
});