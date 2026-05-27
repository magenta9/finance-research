import type { RiskProfileSnapshot } from '@quantdesk/shared';

import type { Repositories } from '../db/repositories';

export const researchRiskProfilePreferenceKey = 'research.riskProfile';

export interface RiskProfileService {
    get: () => RiskProfileSnapshot | null;
    save: (profile: RiskProfileSnapshot) => RiskProfileSnapshot;
}

const isRiskProfileSnapshot = (value: unknown): value is RiskProfileSnapshot => {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const record = value as Partial<RiskProfileSnapshot>;
    return (
        (record.baseCurrency === 'CNY' || record.baseCurrency === 'HKD' || record.baseCurrency === 'USD')
        && typeof record.maxDrawdown === 'number'
        && typeof record.maxSingleWeight === 'number'
        && typeof record.singlePositionLossBudget === 'number'
        && (record.riskTolerance === 'low' || record.riskTolerance === 'medium' || record.riskTolerance === 'high' || record.riskTolerance === 'unknown')
        && typeof record.updatedAt === 'string'
    );
};

export const createRiskProfileService = (
    preferencesRepository: Pick<Repositories['preferencesRepository'], 'get' | 'set'>,
): RiskProfileService => ({
    get() {
        const raw = preferencesRepository.get(researchRiskProfilePreferenceKey);

        if (!raw) {
            return null;
        }

        try {
            const parsed = JSON.parse(raw) as unknown;

            return isRiskProfileSnapshot(parsed) ? parsed : null;
        } catch (error) {
            void error;
            return null;
        }
    },
    save(profile) {
        const normalized = {
            ...profile,
            updatedAt: profile.updatedAt || new Date().toISOString(),
        };

        preferencesRepository.set(researchRiskProfilePreferenceKey, JSON.stringify(normalized));
        return normalized;
    },
});