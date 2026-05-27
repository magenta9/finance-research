import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

import { runMigrations } from '../database';
import { createRepositories } from '../repositories';

describe('researchArtifactRepository', () => {
    test('persists research requests and artifacts', () => {
        const database = new Database(':memory:');
        runMigrations(database);

        try {
            const repositories = createRepositories(database);
            const request = repositories.researchArtifactRepository.createRequest({
                id: 'request-1',
                request: { query: '研究 SPY' },
                status: 'running',
            });

            expect(request.status).toBe('running');

            const artifact = repositories.researchArtifactRepository.saveArtifact({
                artifactType: 'route',
                dataProvenance: [],
                payload: {
                    normalizedRequest: {
                        actionIntensity: 'low',
                        actionIntent: 'observe',
                        assetClassHint: null,
                        assetScope: 'unknown',
                        assetType: 'unknown',
                        dataNeeds: ['local_asset_pool'],
                        riskLevel: 'unknown',
                        taskType: 'general',
                        timeHorizon: 'weeks_to_months',
                    },
                    notSummoned: [],
                    reviewers: ['data_quality'],
                    summonedResearchers: ['trend'],
                },
                promptVersionManifest: [],
                requestId: request.id,
                role: null,
            });

            const completed = repositories.researchArtifactRepository.updateRequest(request.id, {
                completedAt: '2026-04-28T00:00:00.000Z',
                decisionCard: {
                    actionLevel: 'prepare',
                    dataGaps: ['fundamental coverage missing'],
                    edgeType: 'none',
                    entryConditions: [],
                    invalidation: [],
                    payoffGrade: 'medium',
                    positionLevel: 'small',
                    reviewTrigger: 'provider failure',
                    takeProfitOrExit: [],
                    timeHorizon: 'weeks_to_months',
                    winRateGrade: 'medium',
                },
                preflight: {
                    checkedAt: '2026-04-28T00:00:00.000Z',
                    checks: [{
                        checkedAt: '2026-04-28T00:00:00.000Z',
                        details: 'Pi-backed researcher runtime is available.',
                        id: 'runtime.researcher',
                        label: 'Research runtime',
                        status: 'pass',
                    }],
                    runtimeMode: 'pi',
                    status: 'pass',
                },
                runtimeMode: 'pi',
                status: 'completed',
            });
            repositories.researchArtifactRepository.saveArtifact({
                artifactType: 'context_snapshot',
                dataProvenance: [],
                payload: {
                    assets: [{
                        assetClass: 'equity',
                        createdAt: '2026-04-28T00:00:00.000Z',
                        currency: 'HKD',
                        id: 'asset-hstech',
                        market: 'HK',
                        metadata: {},
                        name: '恒生科技 ETF',
                        symbol: 'HSTECH',
                        tags: ['恒生科技'],
                        updatedAt: '2026-04-28T00:00:00.000Z',
                    }],
                    dataSources: [
                        { id: 'provider.fundamentals', kind: 'provider', label: 'Fundamentals', providerIds: [], qualityStatus: 'warn', roleAffinity: ['fundamental'], status: 'contract', toolNames: [], warnings: [] },
                        { id: 'provider.news', kind: 'provider', label: 'News', providerIds: [], qualityStatus: 'block', roleAffinity: ['fundamental'], status: 'unavailable', toolNames: [], warnings: ['No provider configured.'] },
                    ],
                    generatedAt: '2026-04-28T00:00:00.000Z',
                    latestAllocationPlan: null,
                    missingAssetIds: [],
                    portfolioName: 'default',
                    positions: [],
                    priceCoverage: [],
                    priceSignals: [],
                    provenance: [],
                    riskProfile: null,
                },
                promptVersionManifest: [],
                requestId: request.id,
                role: null,
            });
            repositories.researchArtifactRepository.saveArtifact({
                artifactType: 'review_gate',
                dataProvenance: [],
                payload: {
                    dataProvenance: [],
                    reasons: ['Provider unavailable.'],
                    reasonCodes: ['provider_source_unavailable'],
                    requiredDowngrades: ['Keep action at prepare.'],
                    reviewerRole: 'devil_advocate',
                    status: 'warn',
                    verdict: 'Provider failure requires review.',
                },
                promptVersionManifest: [],
                requestId: request.id,
                role: 'devil_advocate',
            });

            expect(completed.status).toBe('completed');
            expect(completed.preflight?.runtimeMode).toBe('pi');
            expect(repositories.researchArtifactRepository.listArtifactsByRequest(request.id)).toEqual(expect.arrayContaining([artifact]));
            expect(repositories.researchArtifactRepository.listRequestSummaries({ limit: 1 }).items[0]).toEqual(expect.objectContaining({
                preflight: expect.objectContaining({ status: 'pass' }),
                projection: expect.objectContaining({
                    actionLevel: 'prepare',
                    assetIds: ['asset-hstech'],
                    assetSymbols: ['HSTECH', '恒生科技 ETF'],
                    dataSourceSummary: expect.objectContaining({ contract: 1 }),
                    providerFailureCount: 1,
                    reviewTriggered: true,
                    runtimeMode: 'pi',
                    taskType: 'general',
                    warnedGateCount: 1,
                }),
                runtimeMode: 'pi',
            }));
            expect(repositories.researchArtifactRepository.listRequestSummaries({ dataSourceStatus: 'contract', runtimeMode: 'pi' }).items).toHaveLength(1);
            expect(repositories.researchArtifactRepository.listRequestSummaries({ actionLevel: 'prepare', targetText: 'hstech', taskType: 'general' }).items).toHaveLength(1);
            expect(repositories.researchArtifactRepository.listRequestSummaries({ gateStatus: 'warn', providerFailure: true, reviewTriggered: true }).items).toHaveLength(1);
            expect(repositories.researchArtifactRepository.listRequestSummaries({ gateStatus: 'block' }).items).toHaveLength(0);
            expect(repositories.researchArtifactRepository.listRequestSummaries({ providerFailure: false }).items).toHaveLength(0);
            expect(repositories.researchArtifactRepository.listRequestSummaries({ runtimeMode: 'deterministic' }).items).toHaveLength(0);

            database.prepare('DELETE FROM research_request_history_projection WHERE request_id = ?').run(request.id);
            repositories.researchArtifactRepository.backfillMissingHistoryProjections();
            expect(repositories.researchArtifactRepository.listRequestSummaries({ targetText: 'hstech' }).items).toHaveLength(1);
        } finally {
            database.close();
        }
    });

    test('backfills all missing history projections before applying projection filters', () => {
        const database = new Database(':memory:');
        runMigrations(database);

        try {
            const repositories = createRepositories(database);
            const target = repositories.researchArtifactRepository.createRequest({
                id: 'request-target',
                request: { query: '研究 HSTECH' },
                status: 'completed',
            });

            for (let index = 0; index < 101; index += 1) {
                repositories.researchArtifactRepository.createRequest({
                    id: `request-dummy-${index}`,
                    request: { query: `研究 DUMMY ${index}` },
                    status: 'completed',
                });
            }

            database.prepare('UPDATE research_requests SET updated_at = ? WHERE id = ?').run('2026-04-28T00:00:00.000Z', target.id);
            database.prepare('UPDATE research_requests SET updated_at = ? WHERE id != ?').run('2026-04-29T00:00:00.000Z', target.id);
            database.prepare('DELETE FROM research_request_history_projection').run();

            repositories.researchArtifactRepository.backfillMissingHistoryProjections();
            const result = repositories.researchArtifactRepository.listRequestSummaries({ targetText: 'hstech' });

            expect(result.items.map((item) => item.id)).toContain(target.id);
            expect(database.prepare('SELECT COUNT(*) AS count FROM research_request_history_projection').get()).toEqual({ count: 102 });
        } finally {
            database.close();
        }
    });
});