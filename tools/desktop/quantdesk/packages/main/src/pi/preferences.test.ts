import { describe, expect, test } from 'vitest';

import { preferenceKeys } from '../preferences/preference-keys';
import { createPiRiskGatePreferences } from './preferences';

describe('pi risk gate preferences', () => {
  test('stores the high privilege acknowledgement behind centralized keys', () => {
    const preferences = new Map<string, string>();
    const riskGate = createPiRiskGatePreferences({
      get: (key) => preferences.get(key) ?? null,
      set: (key, value) => {
        preferences.set(key, value);
        return value;
      },
    });

    const state = riskGate.acknowledgeHighPrivilegeRisk();

    expect(state.acknowledged).toBe(true);
    expect(preferences.get(preferenceKeys.piAgent.highPrivilegeRiskAcknowledged)).toBe('true');
    expect(preferences.get(preferenceKeys.piAgent.highPrivilegeRiskAcknowledgedAt)).toBe(state.acknowledgedAt);
    expect(riskGate.getRiskGateState()).toEqual(state);
  });
});