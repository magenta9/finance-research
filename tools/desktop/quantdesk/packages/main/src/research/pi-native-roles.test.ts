import { describe, expect, test } from 'vitest';

import { financeToolDefinitions } from '../agent/capabilities/finance/definitions';
import { getPiNativeResearchRoleDefinition, piNativeResearchRoleDefinitions, selectPiNativeResearchRoles } from './pi-native-roles';

describe('pi native research roles', () => {
    test('defines every native role with prompts and valid finance tools', () => {
        const financeToolNames = new Set(financeToolDefinitions.map((definition) => definition.name));

        expect(piNativeResearchRoleDefinitions.map((definition) => definition.role)).toEqual([
            'allocation',
            'trend',
            'macro',
            'fundamental',
            'risk',
            'factor',
            'flow_sentiment',
            'execution',
        ]);

        for (const definition of piNativeResearchRoleDefinitions) {
            expect(definition.description.length).toBeGreaterThan(0);
            expect(definition.taskInstruction.length).toBeGreaterThan(0);
            expect(definition.allowedToolNames.length).toBeGreaterThan(0);
            expect(definition.allowedToolNames.every((toolName) => financeToolNames.has(toolName))).toBe(true);
        }
    });

    test('selects a focused role set by normalized task shape', () => {
        expect(selectPiNativeResearchRoles({ actionIntent: 'rebalance', taskType: 'allocation' })).toEqual(['allocation', 'macro', 'risk', 'execution']);
        expect(selectPiNativeResearchRoles({ actionIntent: 'trade', taskType: 'short_term_trade' })).toEqual(['trend', 'flow_sentiment', 'execution', 'risk']);
        expect(selectPiNativeResearchRoles({ actionIntent: 'observe', taskType: 'general' })).toEqual(['trend', 'risk']);
    });

    test('rejects unknown roles explicitly', () => {
        expect(() => getPiNativeResearchRoleDefinition('unknown' as never)).toThrow('Unknown Agent research role');
    });
});