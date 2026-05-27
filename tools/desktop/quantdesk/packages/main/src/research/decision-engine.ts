import type {
    DecisionCard,
    ResearchActionLevel,
    ResearchEdgeType,
    ResearchGrade,
    ResearchTaskRoute,
    ResearcherOutput,
    ReviewGateResult,
    RiskProfileSnapshot,
} from '@quantdesk/shared';

const gradeRank: Record<ResearchGrade, number> = {
    none: 0,
    unknown: 0,
    weak: 1,
    medium: 2,
    strong: 3,
};

const pickBestGrade = (grades: ResearchGrade[]): ResearchGrade =>
    grades.reduce<ResearchGrade>((best, grade) => (gradeRank[grade] > gradeRank[best] ? grade : best), 'unknown');

const rankAction: Record<ResearchActionLevel, number> = {
    avoid: 0,
    observe: 1,
    prepare: 2,
    suggested_operation: 3,
    trading_plan: 4,
};

const clampAction = (action: ResearchActionLevel, maxAction: ResearchActionLevel): ResearchActionLevel => (
    rankAction[action] > rankAction[maxAction] ? maxAction : action
);

const deriveBaseAction = (route: ResearchTaskRoute, edgeType: ResearchEdgeType | 'none', edgeStrength: ResearchGrade): ResearchActionLevel => {
    if (edgeType === 'none' || gradeRank[edgeStrength] <= 0) {
        return 'observe';
    }

    if (route.normalizedRequest.actionIntent === 'trade' && gradeRank[edgeStrength] >= 2) {
        return route.normalizedRequest.actionIntensity === 'high' ? 'trading_plan' : 'suggested_operation';
    }

    if (route.normalizedRequest.actionIntent === 'rebalance') {
        return gradeRank[edgeStrength] >= 2 ? 'suggested_operation' : 'prepare';
    }

    return 'prepare';
};

const pickEdgeType = (outputs: ResearcherOutput[]): ResearchEdgeType | 'none' => {
    const counts = new Map<ResearchEdgeType, number>();

    for (const output of outputs) {
        for (const edgeType of output.edgeTypes) {
            counts.set(edgeType, (counts.get(edgeType) ?? 0) + 1);
        }
    }

    return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? 'none';
};

const hasVerifiableProvenance = (outputs: ResearcherOutput[]) => outputs.some((output) => (
    output.dataProvenance.length > 0
    || output.evidence.some((item) => item.provenance.length > 0)
));

export const createDecisionCard = ({
    gates,
    outputs,
    riskProfile,
    route,
}: {
    gates: ReviewGateResult[];
    outputs: ResearcherOutput[];
    riskProfile: RiskProfileSnapshot | null;
    route: ResearchTaskRoute;
}): DecisionCard => {
    const dataBlock = gates.some((gate) => gate.status === 'block');
    const edgeType = pickEdgeType(outputs);
    const edgeStrength = pickBestGrade(outputs.map((output) => output.edgeStrength));
    const winRateGrade = pickBestGrade(outputs.map((output) => output.winRateGrade));
    const payoffGrade = pickBestGrade(outputs.map((output) => output.payoffGrade));
    const rawAction = deriveBaseAction(route, edgeType, edgeStrength);
    const noProvenance = !hasVerifiableProvenance(outputs);
    const actionLevel = dataBlock || noProvenance
        ? clampAction(rawAction, 'observe')
        : gates.some((gate) => gate.status === 'warn')
            ? clampAction(rawAction, 'prepare')
            : rawAction;
    const dataGaps = Array.from(new Set([
        ...outputs.flatMap((output) => output.dataGaps),
        ...gates.flatMap((gate) => gate.reasons),
        ...(noProvenance ? ['No researcher output included verifiable provenance; action is capped at observe.'] : []),
    ]));
    const hasDataGaps = dataGaps.length > 0;

    return {
        actionLevel,
        dataGaps,
        edgeType,
        entryConditions: dataBlock
            ? ['Resolve blocked data-quality items before acting.']
            : hasDataGaps
                ? ['Resolve listed data gaps or keep action at preparation level.']
                : ['Wait for the stated setup before action.'],
        invalidation: Array.from(new Set(outputs.flatMap((output) => output.invalidationConditions))).slice(0, 5),
        payoffGrade,
        positionLevel: actionLevel === 'avoid' || actionLevel === 'observe'
            ? 'none'
            : riskProfile
                ? (riskProfile.maxSingleWeight <= 0.1 ? 'small' : 'medium')
                : 'precise_unavailable',
        reviewTrigger: dataBlock
            ? 'Review after local price data and risk profile issues are resolved.'
            : 'Review when price breaks invalidation, risk budget changes, or data freshness deteriorates.',
        takeProfitOrExit: ['Exit or downgrade when invalidation is hit or edge grade falls below medium.'],
        timeHorizon: route.normalizedRequest.timeHorizon,
        winRateGrade,
    };
};