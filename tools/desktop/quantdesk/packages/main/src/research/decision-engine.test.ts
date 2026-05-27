import { describe, expect, test } from 'vitest';

import type { ResearchTaskRoute, ResearcherOutput, ReviewGateResult } from '@quantdesk/shared';

import { createDecisionCard } from './decision-engine';

const route: ResearchTaskRoute = {
    normalizedRequest: {
        actionIntensity: 'high',
        actionIntent: 'trade',
        assetClassHint: null,
        assetScope: 'single_asset',
        assetType: 'US',
        dataNeeds: ['price_history'],
        riskLevel: 'high',
        taskType: 'short_term_trade',
        timeHorizon: 'days_to_weeks',
    },
    notSummoned: [],
    reviewers: ['data_quality'],
    summonedResearchers: ['trend', 'risk'],
};

const output: ResearcherOutput = {
    actionRecommendation: 'trading_plan',
    assumptions: [],
    confidence: 'medium',
    conclusion: 'Trend is actionable.',
    dataGaps: [],
    dataProvenance: [],
    direction: 'bullish',
    edgeStrength: 'strong',
    edgeTypes: ['win_rate'],
    evidence: [],
    invalidationConditions: ['Breaks support.'],
    needsSecondReview: false,
    payoffGrade: 'medium',
    requestId: 'request-1',
    risks: [],
    role: 'trend',
    timeHorizon: 'days_to_weeks',
    winRateGrade: 'strong',
};

const blockedGate: ReviewGateResult = {
    dataProvenance: [],
    reasons: ['No price data.'],
    reasonCodes: ['price_history_missing'],
    requiredDowngrades: ['Observe only.'],
    reviewerRole: 'data_quality',
    status: 'block',
    verdict: 'Blocked.',
};

describe('createDecisionCard', () => {
    test('downgrades aggressive action when data gate blocks', () => {
        const decisionCard = createDecisionCard({
            gates: [blockedGate],
            outputs: [output],
            riskProfile: null,
            route,
        });

        expect(decisionCard.actionLevel).toBe('observe');
        expect(decisionCard.positionLevel).toBe('none');
        expect(decisionCard.dataGaps).toContain('No price data.');
    });

    test('does not require local data refresh when no data gap exists', () => {
        const decisionCard = createDecisionCard({
            gates: [{
                dataProvenance: [],
                reasons: [],
                reasonCodes: [],
                requiredDowngrades: [],
                reviewerRole: 'data_quality',
                status: 'pass',
                verdict: 'Pass.',
            }],
            outputs: [{
                ...output,
                dataProvenance: [{
                    fetchedAt: '2026-04-28T00:00:00.000Z',
                    qualityStatus: 'pass',
                    sourceId: 'daily_prices:asset-1',
                    warnings: [],
                }],
            }],
            riskProfile: {
                baseCurrency: 'CNY',
                maxDrawdown: 0.15,
                maxSingleWeight: 0.12,
                riskTolerance: 'medium',
                singlePositionLossBudget: 0.02,
                updatedAt: '2026-04-28T00:00:00.000Z',
            },
            route,
        });

        expect(decisionCard.entryConditions).toEqual(['Wait for the stated setup before action.']);
    });
});