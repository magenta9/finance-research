import type { ResearchContextSnapshotArtifact, RiskProfileSnapshot } from '@quantdesk/shared';

import type { ResearchContextSnapshot } from './context-snapshot';

const createRiskProfileAuditSnapshot = (riskProfile: RiskProfileSnapshot | null): ResearchContextSnapshotArtifact['riskProfile'] => (riskProfile
    ? {
        baseCurrency: riskProfile.baseCurrency,
        hasPositionSizingRules: true,
        riskTolerance: riskProfile.riskTolerance,
        updatedAt: riskProfile.updatedAt,
    }
    : null);

export const createContextSnapshotArtifact = (context: ResearchContextSnapshot): ResearchContextSnapshotArtifact => ({
    ...context,
    riskProfile: createRiskProfileAuditSnapshot(context.riskProfile),
});