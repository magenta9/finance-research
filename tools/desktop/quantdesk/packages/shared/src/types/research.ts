import type { AssetClass, Currency, Market } from './domain';
import type { AllocationPlanRecord, PositionRecord, StoredAsset } from './persistence';

export type ResearchRole =
    | 'allocation'
    | 'trend'
    | 'macro'
    | 'fundamental'
    | 'risk'
    | 'factor'
    | 'flow_sentiment'
    | 'execution';

export type ReviewerRole = 'data_quality' | 'devil_advocate';
export type ResearchParticipantRole = ResearchRole | ReviewerRole;

export type ResearchTaskType =
    | 'allocation'
    | 'short_term_trade'
    | 'single_asset'
    | 'macro'
    | 'portfolio_review'
    | 'general';

export type ResearchAssetScope = 'portfolio' | 'watchlist' | 'single_asset' | 'multi_asset' | 'unknown';
export type ResearchActionIntent = 'observe' | 'prepare' | 'trade' | 'rebalance' | 'review';
export type ResearchActionIntensity = 'low' | 'medium' | 'high';
export type ResearchRiskLevel = 'unknown' | 'low' | 'medium' | 'high';

export type ResearchEdgeType =
    | 'win_rate'
    | 'payoff'
    | 'risk_adjusted'
    | 'diversification'
    | 'execution'
    | 'information';

export type ResearchGrade = 'unknown' | 'none' | 'weak' | 'medium' | 'strong';
export type ResearchConfidence = 'low' | 'medium' | 'high';
export type ResearchDirection = 'bullish' | 'bearish' | 'neutral' | 'mixed';
export type ResearchGateStatus = 'pass' | 'warn' | 'block';
export type ResearchActionLevel = 'avoid' | 'observe' | 'prepare' | 'suggested_operation' | 'trading_plan';
export type ResearchPositionLevel = 'none' | 'small' | 'medium' | 'large' | 'precise_unavailable';
export type ResearchRequestStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type ResearchRuntimeMode = 'deterministic' | 'pi' | 'pi-native';
export type ResearchDataSourceStatus = 'available' | 'degraded' | 'unavailable' | 'contract';
export type ResearchDataSourceKind = 'local' | 'provider' | 'tool' | 'derived';
export type ResearchArtifactType =
    | 'route'
    | 'context_snapshot'
    | 'researcher_output'
    | 'researcher_failure'
    | 'tool_execution'
    | 'review_gate'
    | 'conflict'
    | 'decision_card'
    | 'prompt_snapshot'
    | 'report';

export type ResearchConflictType = 'cycle' | 'data' | 'method' | 'objective' | 'action_intensity';
export type ResearchGateReasonCode =
    | 'aggressive_action_review_required'
    | 'allocation_window_insufficient'
    | 'local_asset_pool_empty'
    | 'market_source_unfetched'
    | 'missing_provenance'
    | 'price_history_missing'
    | 'price_history_stale'
    | 'provider_degraded'
    | 'provider_source_unavailable'
    | 'requested_asset_missing'
    | 'researcher_low_confidence'
    | 'researcher_runtime_failure'
    | 'researcher_second_review_requested'
    | 'schema_invalid'
    | 'schema_repair'
    | 'unauthorized_tool'
    | 'risk_profile_missing';

export type ResearcherFailureReasonCode =
    | 'provider_unavailable'
    | 'runtime_failed'
    | 'schema_invalid'
    | 'timeout'
    | 'unauthorized_tool';

export type ResearchRemediationSeverity = 'info' | 'warn' | 'block';

export type ResearchRemediationCategory =
    | 'data_gap'
    | 'evidence_quality'
    | 'provider_gap'
    | 'route_omission'
    | 'runtime_failure'
    | 'schema_repair'
    | 'tool_policy';

export interface RiskProfileSnapshot {
    baseCurrency: Currency;
    maxDrawdown: number;
    maxSingleWeight: number;
    singlePositionLossBudget: number;
    riskTolerance: ResearchRiskLevel;
    updatedAt: string;
}

export interface RiskProfileAuditSnapshot {
    baseCurrency: Currency;
    hasPositionSizingRules: boolean;
    riskTolerance: ResearchRiskLevel;
    updatedAt: string;
}

export interface ResearchRequestInput {
    query: string;
    assetIds?: string[];
    portfolioName?: string;
    riskProfile?: RiskProfileSnapshot | null;
    unresolvedTarget?: string;
}

export interface NormalizedResearchRequest {
    actionIntensity: ResearchActionIntensity;
    actionIntent: ResearchActionIntent;
    assetClassHint: AssetClass | null;
    assetScope: ResearchAssetScope;
    assetType: Market | 'mixed' | 'unknown';
    dataNeeds: string[];
    riskLevel: ResearchRiskLevel;
    taskType: ResearchTaskType;
    timeHorizon: string;
}

export interface ResearchRouteOmission {
    role: ResearchParticipantRole;
    reason: string;
}

export interface ResearchTaskRoute {
    normalizedRequest: NormalizedResearchRequest;
    notSummoned: ResearchRouteOmission[];
    reviewers: ReviewerRole[];
    summonedResearchers: ResearchRole[];
}

export interface DataProvenance {
    analysisWindow?: {
        endDate: string | null;
        startDate: string | null;
    };
    cacheStatus?: 'hit' | 'miss' | 'stale';
    expectedRows?: number | null;
    fallbackProviderIds?: string[];
    fetchedAt: string | null;
    providerIds?: string[];
    qualityStatus: ResearchGateStatus;
    rowsUsed?: number | null;
    sourceId: string;
    sourcePriority?: string[];
    warnings: string[];
}

export interface ResearchEvidenceItem {
    label: string;
    provenance: DataProvenance[];
    summary: string;
}

export interface ResearcherOutputRepairMetadata {
    confidenceForcedLow: boolean;
    needsSecondReviewForced: boolean;
    repairedFields: string[];
    schemaRepairApplied: boolean;
}

export interface ResearcherOutput {
    actionRecommendation: ResearchActionLevel;
    assumptions: string[];
    confidence: ResearchConfidence;
    conclusion: string;
    dataGaps: string[];
    dataProvenance: DataProvenance[];
    direction: ResearchDirection;
    edgeStrength: ResearchGrade;
    edgeTypes: ResearchEdgeType[];
    evidence: ResearchEvidenceItem[];
    invalidationConditions: string[];
    needsSecondReview: boolean;
    payoffGrade: ResearchGrade;
    repairMetadata?: ResearcherOutputRepairMetadata;
    requestId: string;
    risks: string[];
    role: ResearchRole;
    timeHorizon: string;
    winRateGrade: ResearchGrade;
}

export interface ResearchToolExecutionArtifact {
    args: Record<string, unknown>;
    completedAt: string;
    errorCode?: string;
    errorMessage?: string;
    isError?: boolean;
    partialResults: unknown[];
    result: unknown;
    role: ResearchRole;
    runId: string | null;
    sessionId: string;
    startedAt: string;
    toolCallId: string;
    toolName: string;
}

export interface ResearcherFailureArtifact {
    allowedToolNames?: string[];
    error: string;
    attemptedToolName?: string;
    failedAt: string;
    lastToolName?: string;
    reasonCode?: ResearcherFailureReasonCode;
    recovered: boolean;
    remediation?: string;
    requestId: string;
    role: ResearchRole;
    runtimeMode: ResearchRuntimeMode;
}

export interface ResearchRemediationItem {
    blocksActionAbove?: ResearchActionLevel;
    category: ResearchRemediationCategory;
    id: string;
    nextAction: string;
    reasonCode: ResearchGateReasonCode | ResearcherFailureReasonCode;
    role?: ResearchParticipantRole;
    severity: ResearchRemediationSeverity;
    sourceId?: string;
    summary: string;
}

export interface ResearchPromptSnapshotArtifact {
    allowedToolNames: string[];
    capturedAt: string;
    nativeRunId?: string;
    nativeSessionId?: string;
    policyTags: string[];
    prompt: string;
    requestId: string;
    role: ResearchRole;
    runtimeMode: ResearchRuntimeMode;
}

export interface ReviewGateResult {
    dataProvenance: DataProvenance[];
    explanation?: {
        actionConstraint: ResearchActionLevel | 'none';
        reasonCount: number;
        requiredDowngradeCount: number;
        summary: string;
    };
    reasons: string[];
    reasonCodes: ResearchGateReasonCode[];
    requiredDowngrades: string[];
    reviewerRole: ReviewerRole;
    status: ResearchGateStatus;
    verdict: string;
}

export interface ConflictRecord {
    id: string;
    roles: ResearchRole[];
    severity: ResearchGateStatus;
    summary: string;
    type: ResearchConflictType;
}

export interface DecisionCard {
    actionLevel: ResearchActionLevel;
    dataGaps: string[];
    edgeType: ResearchEdgeType | 'none';
    entryConditions: string[];
    invalidation: string[];
    payoffGrade: ResearchGrade;
    positionLevel: ResearchPositionLevel;
    reviewTrigger: string;
    takeProfitOrExit: string[];
    timeHorizon: string;
    winRateGrade: ResearchGrade;
}

export interface PromptVersionManifestEntry {
    id: string;
    layer: string;
    version: string;
}

export interface ResearchReport {
    conclusion: string;
    consensus: string[];
    dataGaps: string[];
    decisionCard: DecisionCard;
    disagreements: ConflictRecord[];
    generatedAt: string;
    notSummoned: ResearchRouteOmission[];
    promptVersionManifest: PromptVersionManifestEntry[];
    remediationItems?: ResearchRemediationItem[];
    reviewerGates: ReviewGateResult[];
    riskView: string;
    sections: Array<{
        title: string;
        body: string;
    }>;
    summonedResearchers: ResearchRole[];
    title: string;
}

export interface ResearchPreflightCheck {
    checkedAt: string;
    details: string;
    id: string;
    label: string;
    status: ResearchGateStatus;
}

export interface ResearchPreflightSnapshot {
    checkedAt: string;
    checks: ResearchPreflightCheck[];
    runtimeMode: ResearchRuntimeMode;
    status: ResearchGateStatus;
}

export interface ResearchRequestRecord {
    completedAt: string | null;
    createdAt: string;
    decisionCard: DecisionCard | null;
    error: string | null;
    id: string;
    input: ResearchRequestInput;
    normalizedRequest: NormalizedResearchRequest | null;
    preflight: ResearchPreflightSnapshot | null;
    report: ResearchReport | null;
    route: ResearchTaskRoute | null;
    runtimeMode: ResearchRuntimeMode | null;
    status: ResearchRequestStatus;
    updatedAt: string;
}

export interface ResearchRequestHistoryProjection {
    actionLevel: ResearchActionLevel | null;
    assetIds: string[];
    assetSymbols: string[];
    blockedGateCount: number;
    dataGapCount: number;
    dataSourceSummary: Record<ResearchDataSourceStatus, number>;
    providerFailureCount: number;
    researcherFailureCount: number;
    reviewTriggered: boolean;
    runtimeMode: ResearchRuntimeMode | null;
    taskType: ResearchTaskType | null;
    toolExecutionCount: number;
    warnedGateCount: number;
}

export interface ResearchRequestSummary {
    completedAt: string | null;
    createdAt: string;
    decisionCard: DecisionCard | null;
    error: string | null;
    id: string;
    input: ResearchRequestInput;
    preflight: ResearchPreflightSnapshot | null;
    projection?: ResearchRequestHistoryProjection;
    runtimeMode: ResearchRuntimeMode | null;
    status: ResearchRequestStatus;
    updatedAt: string;
}

export interface ResearchRequestListQuery {
    actionLevel?: ResearchActionLevel;
    dataSourceStatus?: ResearchDataSourceStatus;
    gateStatus?: ResearchGateStatus;
    hasResearcherFailure?: boolean;
    limit?: number;
    offset?: number;
    providerFailure?: boolean;
    reviewTriggered?: boolean;
    runtimeMode?: ResearchRuntimeMode;
    status?: ResearchRequestStatus;
    targetText?: string;
    taskType?: ResearchTaskType;
    text?: string;
}

export interface ResearchRequestListResponse {
    items: ResearchRequestSummary[];
    nextOffset: number | null;
    total: number;
}

export interface ResearchAssetPriceCoverageSnapshot {
    assetId: string;
    cacheStatus: 'hit' | 'miss' | 'stale';
    earliestDate: string | null;
    fallbackProviderIds: string[];
    fetchedAt: string | null;
    latestDate: string | null;
    providerIds: string[];
    rowCount: number;
    source: string;
    sourcePriority: string[];
    status: DataProvenance['qualityStatus'];
    symbol: string;
    warnings: string[];
}

export interface ResearchAssetPriceSignalSnapshot {
    assetId: string;
    latestClose: number | null;
    latestDate: string | null;
    returnOneMonth: number | null;
    returnOneYear: number | null;
    returnThreeMonths: number | null;
    source: string | null;
    symbol: string;
}

export interface ResearchDataSourceSnapshot {
    capabilities?: string[];
    cost?: 'external' | 'local' | 'paid' | 'unknown';
    coverage?: {
        assetClasses: string[];
        markets: string[];
        notes: string[];
    };
    failureModes?: string[];
    freshness?: {
        asOf: string | null;
        expectedLag: string | null;
        status: 'cached' | 'live' | 'unavailable' | 'unknown';
    };
    id: string;
    kind: ResearchDataSourceKind;
    label: string;
    providerIds: string[];
    qualityStatus: ResearchGateStatus;
    roleAffinity: ResearchRole[];
    status: ResearchDataSourceStatus;
    toolNames: string[];
    warnings: string[];
}

export interface ResearchContextSnapshotArtifact {
    assets: StoredAsset[];
    dataSources: ResearchDataSourceSnapshot[];
    generatedAt: string;
    latestAllocationPlan: AllocationPlanRecord | null;
    missingAssetIds: string[];
    portfolioName: string;
    positions: PositionRecord[];
    priceCoverage: ResearchAssetPriceCoverageSnapshot[];
    priceSignals: ResearchAssetPriceSignalSnapshot[];
    provenance: DataProvenance[];
    riskProfile: RiskProfileAuditSnapshot | null;
}

export interface ResearchArtifactRecordBase<
    ArtifactType extends ResearchArtifactType,
    Payload,
    Role extends ResearchParticipantRole | null,
> {
    artifactType: ArtifactType;
    createdAt: string;
    dataProvenance: DataProvenance[];
    id: string;
    payload: Payload;
    promptVersionManifest: PromptVersionManifestEntry[];
    requestId: string;
    role: Role;
}

export type ResearchArtifactRecord =
    | ResearchArtifactRecordBase<'route', ResearchTaskRoute, null>
    | ResearchArtifactRecordBase<'context_snapshot', ResearchContextSnapshotArtifact, null>
    | ResearchArtifactRecordBase<'prompt_snapshot', ResearchPromptSnapshotArtifact, ResearchRole>
    | ResearchArtifactRecordBase<'researcher_output', ResearcherOutput, ResearchRole>
    | ResearchArtifactRecordBase<'researcher_failure', ResearcherFailureArtifact, ResearchRole>
    | ResearchArtifactRecordBase<'tool_execution', ResearchToolExecutionArtifact, ResearchRole>
    | ResearchArtifactRecordBase<'review_gate', ReviewGateResult, ReviewerRole>
    | ResearchArtifactRecordBase<'conflict', ConflictRecord, null>
    | ResearchArtifactRecordBase<'decision_card', DecisionCard, null>
    | ResearchArtifactRecordBase<'report', ResearchReport, null>;

export type ResearchArtifactPayload = ResearchArtifactRecord['payload'];

export type ResearchArtifactWriteInput = ResearchArtifactRecord extends infer Artifact
    ? Artifact extends ResearchArtifactRecord
    ? Omit<Artifact, 'createdAt' | 'id'> & { id?: string }
    : never
    : never;

export type ResearchStreamEvent =
    | {
        request: ResearchRequestRecord;
        timestamp: string;
        type: 'request_started';
    }
    | {
        requestId: string;
        role: ResearchRole;
        runtimeMode: ResearchRuntimeMode;
        timestamp: string;
        type: 'researcher_started';
    }
    | {
        reason: string;
        requestId: string;
        requestedRuntimeMode: ResearchRuntimeMode;
        runtimeMode: ResearchRuntimeMode;
        timestamp: string;
        type: 'runtime_degraded';
    }
    | {
        args: Record<string, unknown>;
        requestId: string;
        role: ResearchRole;
        runId: string | null;
        sessionId: string;
        timestamp: string;
        toolCallId: string;
        toolName: string;
        type: 'research_tool_started';
    }
    | {
        args: Record<string, unknown>;
        partialResult: unknown;
        requestId: string;
        role: ResearchRole;
        runId: string | null;
        sessionId: string;
        timestamp: string;
        toolCallId: string;
        toolName: string;
        type: 'research_tool_updated';
    }
    | {
        args: Record<string, unknown>;
        errorCode?: string;
        errorMessage?: string;
        isError?: boolean;
        requestId: string;
        result: unknown;
        role: ResearchRole;
        runId: string | null;
        sessionId: string;
        timestamp: string;
        toolCallId: string;
        toolName: string;
        type: 'research_tool_completed';
    }
    | {
        output: ResearcherOutput;
        requestId: string;
        timestamp: string;
        type: 'researcher_completed';
    }
    | {
        error: string;
        requestId: string;
        role: ResearchRole;
        runtimeMode: ResearchRuntimeMode;
        timestamp: string;
        type: 'researcher_failed';
    }
    | {
        gate: ReviewGateResult;
        requestId: string;
        timestamp: string;
        type: 'review_gate_completed';
    }
    | {
        request: ResearchRequestRecord;
        timestamp: string;
        type: 'request_completed';
    }
    | {
        request: ResearchRequestRecord;
        timestamp: string;
        type: 'request_cancelled';
    }
    | {
        error: string;
        requestId: string;
        timestamp: string;
        type: 'request_failed';
    };

export interface ResearchCancelResponse {
    cancelled: boolean;
}