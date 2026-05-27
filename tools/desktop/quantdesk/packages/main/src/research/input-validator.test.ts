import { describe, expect, test } from 'vitest';

import { validateResearchRequestInput, validateRiskProfileSnapshot } from './input-validator';

describe('research input validators', () => {
    test('normalizes a bounded research request and strips extra fields', () => {
        expect(validateResearchRequestInput({
            assetIds: [' asset-1 ', 'asset-1'],
            extra: 'ignored',
            portfolioName: ' default ',
            query: '  研究组合  ',
        })).toEqual({
            assetIds: ['asset-1'],
            portfolioName: 'default',
            query: '研究组合',
            riskProfile: null,
        });
    });

    test('rejects oversized research requests', () => {
        expect(() => validateResearchRequestInput({ query: 'x'.repeat(4_001) })).toThrow('query');
        expect(() => validateResearchRequestInput({ assetIds: Array.from({ length: 51 }, (_, index) => `asset-${index}`), query: '研究' })).toThrow('assetIds');
    });

    test('rejects invalid risk profile values', () => {
        expect(() => validateRiskProfileSnapshot({
            baseCurrency: 'USD',
            maxDrawdown: -1,
            maxSingleWeight: 0.2,
            riskTolerance: 'medium',
            singlePositionLossBudget: 0.02,
            updatedAt: '2026-04-28T00:00:00.000Z',
        })).toThrow('maxDrawdown');
    });
});