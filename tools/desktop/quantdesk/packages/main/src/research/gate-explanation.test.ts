import path from 'node:path';

import { describe, expect, test } from 'vitest';

import { createGateExplanation } from './gate-explanation';
import { createResearchSchemaValidator } from './schema-validator';

const contractsRoot = path.resolve(__dirname, '../../../../contracts');

describe('createGateExplanation', () => {
    test('describes action constraints for blocking gates', () => {
        const explanation = createGateExplanation({
            reasons: ['No price data.'],
            requiredDowngrades: ['Observe only.'],
            reviewerRole: 'data_quality',
            status: 'block',
        });

        expect(explanation).toEqual({
            actionConstraint: 'observe',
            reasonCount: 1,
            requiredDowngradeCount: 1,
            summary: 'data_quality blocks aggressive action until 1 issue(s) are resolved.',
        });
    });

    test('is accepted by the review gate schema', () => {
        const validator = createResearchSchemaValidator(contractsRoot);
        const result = validator.validate('review-gate-result', {
            dataProvenance: [],
            explanation: createGateExplanation({
                reasons: [],
                requiredDowngrades: [],
                reviewerRole: 'data_quality',
                status: 'pass',
            }),
            reasons: [],
            reasonCodes: [],
            requiredDowngrades: [],
            reviewerRole: 'data_quality',
            status: 'pass',
            verdict: 'Pass.',
        });

        expect(result).toEqual({ errors: [], ok: true });
    });
});
