import type { Currency, PiRiskGateState, PreferenceMap } from '@quantdesk/shared';

import { preferenceKeys } from './preference-keys';

const PI_RISK_GATE_MESSAGE = 'Pi Agent 具备本地文件访问与命令执行能力。发送消息前需要先明确确认高权限风险。';

export interface PreferenceStore {
  get(key: string): string | null;
  set?: (key: string, value: string) => string;
  getAll?: () => PreferenceMap;
  delete?: (key: string) => boolean;
}

export interface PreferencesService {
  acknowledgePiHighPrivilegeRisk(): PiRiskGateState;
  getBaseCurrency(): Currency;
  getDataSourceEnabled(key: keyof typeof preferenceKeys.dataSource): boolean;
  getPiRiskGateState(): PiRiskGateState;
}

const isCurrency = (value: string | null): value is Currency => value === 'CNY' || value === 'USD' || value === 'HKD';

const buildRiskGateState = (
  acknowledged: boolean,
  acknowledgedAt: string | null,
): PiRiskGateState => ({
  acknowledged,
  acknowledgedAt,
  message: PI_RISK_GATE_MESSAGE,
  required: true,
  riskLevel: 'high',
});

export const createPreferencesService = (preferences: PreferenceStore): PreferencesService => ({
  acknowledgePiHighPrivilegeRisk() {
    if (!preferences.set) {
      throw new Error('Preference store is read-only.');
    }

    const acknowledgedAt = new Date().toISOString();
    preferences.set(preferenceKeys.piAgent.highPrivilegeRiskAcknowledged, 'true');
    preferences.set(preferenceKeys.piAgent.highPrivilegeRiskAcknowledgedAt, acknowledgedAt);
    return buildRiskGateState(true, acknowledgedAt);
  },
  getBaseCurrency() {
    const value = preferences.get(preferenceKeys.baseCurrency);
    return isCurrency(value) ? value : 'CNY';
  },
  getDataSourceEnabled(key) {
    return preferences.get(preferenceKeys.dataSource[key]) !== 'false';
  },
  getPiRiskGateState() {
    const acknowledged = preferences.get(preferenceKeys.piAgent.highPrivilegeRiskAcknowledged) === 'true';
    const acknowledgedAt = preferences.get(preferenceKeys.piAgent.highPrivilegeRiskAcknowledgedAt);
    return buildRiskGateState(acknowledged, acknowledgedAt);
  },
});

export const PI_RISK_GATE_BLOCK_MESSAGE = 'Pi Agent 尚未确认高权限风险，当前禁止发送消息。';
