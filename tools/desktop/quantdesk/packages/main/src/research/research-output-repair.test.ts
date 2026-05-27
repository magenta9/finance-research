import path from 'node:path';

import { describe, expect, test } from 'vitest';

import { createResearchSchemaValidator } from './schema-validator';
import { repairResearcherOutput } from './research-output-repair';

const contractsRoot = path.resolve(__dirname, '../../../../contracts');

describe('repairResearcherOutput', () => {
    test('normalizes common model output drift into a schema-valid researcher output', () => {
        const repaired = repairResearcherOutput({
            actionRecommendation: 'buy_now',
            assumptions: 'Only local cache checked.',
            confidence: 'certain',
            conclusion: '  Momentum is improving. ',
            dataGaps: 'No fundamental provider connected.',
            dataProvenance: [{ qualityStatus: 'ok', sourceId: '', warnings: 'stale' }],
            direction: 'up',
            edgeStrength: 'medium',
            edgeTypes: 'win_rate',
            evidence: [{ summary: 'Price cache was inspected.' }],
            needsSecondReview: 'yes',
            payoffGrade: 'excellent',
            risks: 'Provider coverage is thin.',
            timeHorizon: '',
            winRateGrade: 'weak',
        }, 'request-1', 'trend');

        const validator = createResearchSchemaValidator(contractsRoot);

        expect(validator.validate('researcher-output', repaired)).toEqual({ errors: [], ok: true });
        expect(repaired.requestId).toBe('request-1');
        expect(repaired.role).toBe('trend');
        expect(repaired.actionRecommendation).toBe('observe');
        expect(repaired.confidence).toBe('low');
        expect(repaired.needsSecondReview).toBe(true);
        expect(repaired.dataGaps).toEqual(expect.arrayContaining([
            'No fundamental provider connected.',
            expect.stringContaining('Model output required schema repair'),
        ]));
    });
});
