import type { PiRiskGateState } from '@quantdesk/shared';

import {
  createPreferencesService,
  type PreferenceStore,
} from '../preferences/preferences-service';

export type PiPreferencesStore = Pick<PreferenceStore, 'get' | 'set'>;

export interface PiRiskGatePreferences {
  acknowledgeHighPrivilegeRisk(): PiRiskGateState;
  getRiskGateState(): PiRiskGateState;
}

export const createPiRiskGatePreferences = (
  preferences: PiPreferencesStore,
): PiRiskGatePreferences => {
  const service = createPreferencesService(preferences);

  return {
    acknowledgeHighPrivilegeRisk: () => service.acknowledgePiHighPrivilegeRisk(),
    getRiskGateState: () => service.getPiRiskGateState(),
  };
};
