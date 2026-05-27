import { describe, expect, test, vi } from 'vitest';

import type { StoredAsset } from '@quantdesk/shared';

import { MetadataBackfillService } from './metadata-backfill-service';

const buildAsset = (metadata: Record<string, unknown> = {}): StoredAsset => ({
    assetClass: 'equity',
    createdAt: '2026-04-15T00:00:00.000Z',
    currency: 'CNY',
    id: 'asset-510300',
    market: 'A',
    metadata,
    name: '沪深300ETF',
    symbol: '510300',
    tags: [],
    updatedAt: '2026-04-15T00:00:00.000Z',
});

describe('MetadataBackfillService', () => {
    test('transitions from idle to running to completed while backfilling known assets', async () => {
        const asset = buildAsset();
        const update = vi.fn((next) => ({ ...asset, ...next, updatedAt: '2026-04-16T00:00:00.000Z' }));
        let resolveLookup!: (value: Array<{
            assetClass: StoredAsset['assetClass'];
            currency: StoredAsset['currency'];
            market: StoredAsset['market'];
            metadata: Record<string, unknown>;
            name: string;
            source: string;
            symbol: string;
        }>) => void;

        const service = new MetadataBackfillService(
            {
                assets: {
                    list: () => [asset],
                    update,
                },
            },
            {
                lookupAssets: vi.fn(() => new Promise<Array<{
                    assetClass: StoredAsset['assetClass'];
                    currency: StoredAsset['currency'];
                    market: StoredAsset['market'];
                    metadata: Record<string, unknown>;
                    name: string;
                    source: string;
                    symbol: string;
                }>>((resolve) => {
                    resolveLookup = resolve;
                })),
            },
        );

        expect(service.getMetadataBackfillStatus()).toMatchObject({
            scannedAssets: 0,
            state: 'idle',
            updatedAssets: 0,
        });

        const pending = service.backfillMetadataForKnownAssets();

        expect(service.getMetadataBackfillStatus()).toMatchObject({
            scannedAssets: 0,
            startedAt: expect.any(String),
            state: 'running',
            updatedAssets: 0,
        });

        resolveLookup!([
            {
                assetClass: 'equity',
                currency: 'CNY',
                market: 'A',
                metadata: {
                    issueDate: '2012-05-28',
                    issueDateSource: 'akshare-fund-name',
                },
                name: '沪深300ETF',
                source: 'akshare',
                symbol: '510300',
            },
        ]);

        const status = await pending;

        expect(update).toHaveBeenCalledTimes(1);
        expect(status).toMatchObject({
            failedAssets: 0,
            scannedAssets: 1,
            state: 'completed',
            updatedAssets: 1,
        });
    });

    test('skips remote lookup when issueDate already exists', async () => {
        const asset = buildAsset({ issueDate: '2012-05-28', tsCode: '510300.SH' });
        const lookupAssets = vi.fn();
        const service = new MetadataBackfillService(
            {
                assets: {
                    list: () => [asset],
                    update: vi.fn((next) => next),
                },
            },
            { lookupAssets },
        );

        await expect(service.ensureHistoricalMetadata(asset)).resolves.toEqual(asset);
        expect(lookupAssets).not.toHaveBeenCalled();
    });

    test('writes issueDate metadata when lookup returns an exact asset match', async () => {
        const asset = buildAsset();
        const update = vi.fn((next) => ({ ...asset, ...next, updatedAt: '2026-04-16T00:00:00.000Z' }));
        const service = new MetadataBackfillService(
            {
                assets: {
                    list: () => [asset],
                    update,
                },
            },
            {
                lookupAssets: async () => [{
                    assetClass: 'equity',
                    currency: 'CNY',
                    market: 'A',
                    metadata: {
                        issueDate: '2012-05-28',
                        issueDateSource: 'akshare-fund-name',
                        tsCode: '510300.SH',
                        tsCodeAsset: 'FD',
                    },
                    name: '沪深300ETF',
                    source: 'akshare',
                    symbol: '510300',
                }],
            },
        );

        const hydrated = await service.ensureHistoricalMetadata(asset);

        expect(update).toHaveBeenCalledWith(expect.objectContaining({
            metadata: expect.objectContaining({
                issueDate: '2012-05-28',
                issueDateSource: 'akshare-fund-name',
                tsCode: '510300.SH',
                tsCodeAsset: 'FD',
            }),
        }));
        expect(hydrated.metadata).toMatchObject({
            issueDate: '2012-05-28',
            issueDateSource: 'akshare-fund-name',
            tsCode: '510300.SH',
            tsCodeAsset: 'FD',
        });
    });
});
