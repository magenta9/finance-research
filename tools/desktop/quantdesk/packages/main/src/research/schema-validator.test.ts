import path from 'node:path';

import { describe, expect, test } from 'vitest';

import { createResearchSchemaValidator } from './schema-validator';

const contractsRoot = path.resolve(__dirname, '../../../../contracts');

describe('research schema validator', () => {
    test('accepts valid decision cards and rejects malformed payloads', () => {
        const validator = createResearchSchemaValidator(contractsRoot);
        const validDecisionCard = {
            actionLevel: 'observe',
            dataGaps: [],
            edgeType: 'none',
            entryConditions: ['Wait for data.'],
            invalidation: ['No data.'],
            payoffGrade: 'none',
            positionLevel: 'none',
            reviewTrigger: 'Refresh data.',
            takeProfitOrExit: ['No exit.'],
            timeHorizon: 'weeks_to_months',
            winRateGrade: 'none',
        };

        expect(validator.validate('decision-card', validDecisionCard).ok).toBe(true);
        expect(validator.validate('decision-card', { ...validDecisionCard, actionLevel: 'buy_now' }).ok).toBe(false);
    });
});