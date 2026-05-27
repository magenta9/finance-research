import type {
    DataProvenance,
    ResearchActionLevel,
    ResearchConfidence,
    ResearchDirection,
    ResearchEdgeType,
    ResearchGrade,
    ResearchRole,
    ResearcherOutput,
} from '@quantdesk/shared';

const confidenceValues: ResearchConfidence[] = ['low', 'medium', 'high'];
const directionValues: ResearchDirection[] = ['bullish', 'bearish', 'neutral', 'mixed'];
const actionLevelValues: ResearchActionLevel[] = ['avoid', 'observe', 'prepare', 'suggested_operation', 'trading_plan'];
const gradeValues: ResearchGrade[] = ['unknown', 'none', 'weak', 'medium', 'strong'];
const edgeTypeValues: ResearchEdgeType[] = ['win_rate', 'payoff', 'risk_adjusted', 'diversification', 'execution', 'information'];

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

const normalizeEnum = <T extends string>(value: unknown, allowed: readonly T[], fallback: T) => (
    typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback
);

const normalizeString = (value: unknown, fallback: string) => {
    if (typeof value !== 'string') {
        return fallback;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : fallback;
};

const normalizeStringArray = (value: unknown) => {
    if (Array.isArray(value)) {
        return value
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim())
            .filter((item) => item.length > 0);
    }

    if (typeof value === 'string' && value.trim().length > 0) {
        return [value.trim()];
    }

    return [];
};

const normalizeNumberOrNull = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

const normalizeDataProvenance = (value: unknown): DataProvenance[] => {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .filter(isRecord)
        .map((item) => ({
            analysisWindow: isRecord(item.analysisWindow)
                ? {
                    endDate: typeof item.analysisWindow.endDate === 'string' ? item.analysisWindow.endDate : null,
                    startDate: typeof item.analysisWindow.startDate === 'string' ? item.analysisWindow.startDate : null,
                }
                : undefined,
            expectedRows: normalizeNumberOrNull(item.expectedRows),
            fetchedAt: typeof item.fetchedAt === 'string' ? item.fetchedAt : null,
            qualityStatus: normalizeEnum(item.qualityStatus, ['pass', 'warn', 'block'] as const, 'warn'),
            rowsUsed: normalizeNumberOrNull(item.rowsUsed),
            sourceId: normalizeString(item.sourceId, 'model_output'),
            warnings: normalizeStringArray(item.warnings),
        }));
};

const normalizeEvidence = (value: unknown) => {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.filter(isRecord).map((item, index) => ({
        label: normalizeString(item.label, `Evidence ${index + 1}`),
        provenance: normalizeDataProvenance(item.provenance),
        summary: normalizeString(item.summary, 'No evidence summary returned.'),
    }));
};

const normalizeEdgeTypes = (value: unknown) => {
    const values = Array.isArray(value) ? value : [value];

    return values.filter((item): item is ResearchEdgeType => typeof item === 'string' && edgeTypeValues.includes(item as ResearchEdgeType));
};

export const repairResearcherOutput = (value: unknown, requestId: string, role: ResearchRole): ResearcherOutput => {
    const input = isRecord(value) ? value : {};
    const repairedFields: string[] = [];
    const markRepair = (field: string, condition: boolean) => {
        if (condition) {
            repairedFields.push(field);
        }
    };

    markRepair('actionRecommendation', !actionLevelValues.includes(input.actionRecommendation as ResearchActionLevel));
    markRepair('confidence', !confidenceValues.includes(input.confidence as ResearchConfidence));
    markRepair('direction', !directionValues.includes(input.direction as ResearchDirection));
    markRepair('edgeStrength', !gradeValues.includes(input.edgeStrength as ResearchGrade));
    markRepair('payoffGrade', !gradeValues.includes(input.payoffGrade as ResearchGrade));
    markRepair('winRateGrade', !gradeValues.includes(input.winRateGrade as ResearchGrade));
    markRepair('needsSecondReview', typeof input.needsSecondReview !== 'boolean');

    const dataGaps = normalizeStringArray(input.dataGaps);

    const schemaRepairApplied = repairedFields.length > 0;

    if (schemaRepairApplied) {
        dataGaps.push(`Model output required schema repair: ${repairedFields.join(', ')}.`);
    }

    const confidence = normalizeEnum(input.confidence, confidenceValues, 'low');
    const needsSecondReview = typeof input.needsSecondReview === 'boolean' ? input.needsSecondReview : true;

    return {
        actionRecommendation: normalizeEnum(input.actionRecommendation, actionLevelValues, 'observe'),
        assumptions: normalizeStringArray(input.assumptions),
        confidence,
        conclusion: normalizeString(input.conclusion, 'No conclusion returned.'),
        dataGaps,
        dataProvenance: normalizeDataProvenance(input.dataProvenance),
        direction: normalizeEnum(input.direction, directionValues, 'neutral'),
        edgeStrength: normalizeEnum(input.edgeStrength, gradeValues, 'unknown'),
        edgeTypes: normalizeEdgeTypes(input.edgeTypes),
        evidence: normalizeEvidence(input.evidence),
        invalidationConditions: normalizeStringArray(input.invalidationConditions),
        needsSecondReview,
        payoffGrade: normalizeEnum(input.payoffGrade, gradeValues, 'unknown'),
        repairMetadata: {
            confidenceForcedLow: schemaRepairApplied && confidence === 'low' && input.confidence !== 'low',
            needsSecondReviewForced: typeof input.needsSecondReview !== 'boolean' && needsSecondReview,
            repairedFields,
            schemaRepairApplied,
        },
        requestId,
        risks: normalizeStringArray(input.risks),
        role,
        timeHorizon: normalizeString(input.timeHorizon, 'unspecified'),
        winRateGrade: normalizeEnum(input.winRateGrade, gradeValues, 'unknown'),
    };
};
