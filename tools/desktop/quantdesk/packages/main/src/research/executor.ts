import type { ResearchRole, ResearcherOutput, ResearchRuntimeMode, ResearchStreamEvent } from '@quantdesk/shared';

import type { ComposedResearchPrompt } from './prompt-composer';
import type { ResearchContextSnapshot } from './context-snapshot';

export interface ResearchExecutorInput {
    context: ResearchContextSnapshot;
    onRuntimeEvent?: (event: ResearchStreamEvent) => void;
    prompt: ComposedResearchPrompt;
    query: string;
    requestId: string;
    role: ResearchRole;
    signal?: AbortSignal;
}

export interface ResearchExecutor {
    runResearcher: (input: ResearchExecutorInput) => Promise<ResearcherOutput>;
    requestedRuntimeMode?: ResearchRuntimeMode;
    runtimeDegradationReason?: string;
    runtimeMode?: ResearchRuntimeMode;
}

const roleEdgeTypes: Record<ResearchRole, ResearcherOutput['edgeTypes']> = {
    allocation: ['diversification', 'risk_adjusted'],
    execution: ['execution'],
    factor: ['risk_adjusted', 'win_rate'],
    flow_sentiment: ['information'],
    fundamental: ['payoff', 'information'],
    macro: ['diversification', 'information'],
    risk: ['risk_adjusted'],
    trend: ['win_rate', 'payoff'],
};

const roleConclusion: Record<ResearchRole, string> = {
    allocation: 'Local portfolio context supports a measured allocation review rather than an unconstrained trade.',
    execution: 'Execution should stay conditional until liquidity and latest data freshness are confirmed.',
    factor: 'Factor evidence is only first-pass because no dedicated factor data provider is attached in this slice.',
    flow_sentiment: 'Flow and sentiment are treated as data gaps unless a verified source is attached.',
    fundamental: 'Fundamental conclusions are limited because no external financial statement provider is attached.',
    macro: 'Macro view is inferred from local asset exposures and should not be treated as live macro data.',
    risk: 'Risk budget is the binding constraint and can downgrade action intensity.',
    trend: 'Trend evidence can be reviewed from local price history, but stale rows lower conviction.',
};

const formatPercent = (value: number | null) => (value == null ? 'n/a' : `${(value * 100).toFixed(1)}%`);

const formatPriceSignals = (context: ResearchContextSnapshot) => context.priceSignals
    .filter((signal) => signal.latestClose != null)
    .map((signal) => [
        `${signal.symbol} latest ${signal.latestClose?.toFixed(4) ?? 'n/a'} on ${signal.latestDate ?? 'n/a'}`,
        `1M ${formatPercent(signal.returnOneMonth)}`,
        `3M ${formatPercent(signal.returnThreeMonths)}`,
        `1Y ${formatPercent(signal.returnOneYear)}`,
        `source ${signal.source ?? 'n/a'}`,
    ].join(', '));

export interface DeterministicResearchExecutorOptions {
    requestedRuntimeMode?: ResearchRuntimeMode;
    runtimeDegradationReason?: string;
}

export const createDeterministicResearchExecutor = ({
    requestedRuntimeMode,
    runtimeDegradationReason,
}: DeterministicResearchExecutorOptions = {}): ResearchExecutor => ({
    requestedRuntimeMode,
    runtimeDegradationReason,
    runtimeMode: 'deterministic',
    async runResearcher({ context, prompt, requestId, role, signal }) {
        signal?.throwIfAborted();

        const hasBlockedData = context.provenance.some((entry) => entry.qualityStatus === 'block');
        const hasWarnedData = context.provenance.some((entry) => entry.qualityStatus === 'warn');
        const missingRiskProfile = !context.riskProfile;
        const edgeTypes = hasBlockedData ? [] : roleEdgeTypes[role];
        const confidence = hasBlockedData || hasWarnedData || missingRiskProfile ? 'low' : 'medium';
        const priceInvalidations = context.priceCoverage
            .filter((coverage) => coverage.status !== 'pass')
            .map((coverage) => `${coverage.symbol}: local price cache remains missing or stale.`);
        const riskInvalidations = missingRiskProfile
            ? ['Risk profile remains missing, so precise sizing stays unavailable.']
            : ['User risk limits tighten below the intended position size.'];
        const priceSignalSummaries = formatPriceSignals(context);
        const priceSignalSummary = priceSignalSummaries.join('; ');
        const conclusion = priceSignalSummary
            ? `${roleConclusion[role]} Cached price signal: ${priceSignalSummary}.`
            : roleConclusion[role];
        const dataGaps = [
            ...context.missingAssetIds.map((assetId) => `Missing requested asset ${assetId}.`),
            ...context.priceCoverage.flatMap((coverage) => coverage.warnings.map((warning) => `${coverage.symbol}: ${warning}`)),
            ...(missingRiskProfile ? ['Risk profile is missing.'] : []),
            ...(role === 'fundamental' ? ['No external fundamentals provider is attached.'] : []),
            ...(role === 'flow_sentiment' ? ['No verified flow/sentiment provider is attached.'] : []),
            ...(role === 'macro' ? ['No live macro provider is attached.'] : []),
            ...(runtimeDegradationReason ? [`Runtime degraded: ${runtimeDegradationReason}`] : []),
        ];

        return {
            actionRecommendation: hasBlockedData ? 'observe' : role === 'execution' ? 'prepare' : 'suggested_operation',
            assumptions: [
                'Only local QuantDesk assets, positions, allocation plans and cached prices are treated as evidence.',
                `Allowed tools for this role: ${prompt.allowedToolNames.join(', ') || 'none'}.`,
                ...(runtimeDegradationReason ? [`Requested ${requestedRuntimeMode ?? 'pi'} runtime was unavailable; deterministic offline fallback was used.`] : []),
            ],
            confidence,
            conclusion,
            dataGaps,
            dataProvenance: context.provenance,
            direction: hasBlockedData ? 'neutral' : role === 'risk' || role === 'execution' ? 'mixed' : 'neutral',
            edgeStrength: hasBlockedData ? 'none' : hasWarnedData || missingRiskProfile ? 'weak' : 'medium',
            edgeTypes,
            evidence: [
                {
                    label: 'Local context snapshot',
                    provenance: context.provenance,
                    summary: [
                        `${context.assets.length} assets, ${context.positions.length} positions, latest plan ${context.latestAllocationPlan?.name ?? 'none'}.`,
                        priceSignalSummary ? `Price signals: ${priceSignalSummary}.` : null,
                    ].filter(Boolean).join(' '),
                },
            ],
            invalidationConditions: [...priceInvalidations, ...riskInvalidations],
            needsSecondReview: confidence === 'low',
            payoffGrade: hasBlockedData ? 'none' : role === 'fundamental' || role === 'trend' ? 'medium' : 'weak',
            requestId,
            risks: [
                'Evidence is constrained to local cached data in the first implementation slice.',
                'No recommendation should be treated as automatic trade execution.',
                ...(runtimeDegradationReason ? ['Real researcher runtime was unavailable for this request.'] : []),
            ],
            role,
            timeHorizon: role === 'trend' || role === 'execution' ? 'days_to_weeks' : 'weeks_to_months',
            winRateGrade: hasBlockedData ? 'none' : role === 'trend' || role === 'factor' ? 'medium' : 'weak',
        };
    },
});