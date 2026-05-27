import type { DecisionCard, NormalizedResearchRequest, ResearchReport, ResearchRole, ResearchTaskRoute } from '@quantdesk/shared';

import type { Repositories } from '../db/repositories';
import type { ResearchContextSnapshot } from './context-snapshot';
import { createContextSnapshotArtifact } from './context-snapshot-artifact';

type ResearchArtifactRepository = Repositories['researchArtifactRepository'];

export const createPiNativeRoute = (normalizedRequest: NormalizedResearchRequest, roles: ResearchRole[]): ResearchTaskRoute => ({
    normalizedRequest,
    notSummoned: [],
    reviewers: [],
    summonedResearchers: roles,
});

export const savePiNativeRouteArtifacts = (input: {
    context: ResearchContextSnapshot;
    repository: ResearchArtifactRepository;
    requestId: string;
    route: ResearchTaskRoute;
}) => {
    input.repository.saveArtifact({ artifactType: 'route', dataProvenance: [], payload: input.route, promptVersionManifest: [], requestId: input.requestId, role: null });
    input.repository.saveArtifact({
        artifactType: 'context_snapshot',
        dataProvenance: input.context.provenance,
        payload: createContextSnapshotArtifact(input.context),
        promptVersionManifest: [],
        requestId: input.requestId,
        role: null,
    });
};

export const savePiNativeFinalArtifacts = (input: {
    decisionCard: DecisionCard;
    report: ResearchReport;
    repository: ResearchArtifactRepository;
    requestId: string;
}) => {
    input.repository.saveArtifact({
        artifactType: 'decision_card',
        dataProvenance: [],
        payload: input.decisionCard,
        promptVersionManifest: input.report.promptVersionManifest,
        requestId: input.requestId,
        role: null,
    });
    input.repository.saveArtifact({
        artifactType: 'report',
        dataProvenance: [],
        payload: input.report,
        promptVersionManifest: input.report.promptVersionManifest,
        requestId: input.requestId,
        role: null,
    });
};