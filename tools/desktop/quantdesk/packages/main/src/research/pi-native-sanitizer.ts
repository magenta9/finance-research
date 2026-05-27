import type { DataProvenance, ResearchRole, ResearchToolExecutionArtifact, ResearcherOutput } from '@quantdesk/shared';

const maxToolPayloadArrayItems = 20, maxToolPayloadObjectKeys = 40, maxToolPayloadStringLength = 2_000;
const sensitiveToolPayloadKeyPattern = /authorization|cookie|password|secret|token|api[_-]?key/i;
const sensitiveToolPayloadValuePatterns: Array<[RegExp, string]> = [
    [/(authorization:\s*)[^\r\n,;]+/gi, '$1[redacted]'],
    [/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[redacted]'],
    [/(x-api-key:\s*)[^\r\n,;]+/gi, '$1[redacted]'],
    [/("(?:api[_-]?key|token|secret|password)"\s*:\s*")[^"]+(")/gi, '$1[redacted]$2'],
    [/(\b(?:api[_-]?key|token|secret|password)\s*:\s*)[^\s,;}]+/gi, '$1[redacted]'],
    [/((?:api[_-]?key|token|secret|password)=)[^&\s]+/gi, '$1[redacted]'],
    [/(cookie:\s*)[^\r\n]+/gi, '$1[redacted]'],
];

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

export const sanitizeToolPayloadString = (value: string) => {
    const redacted = sensitiveToolPayloadValuePatterns.reduce(
        (current, [pattern, replacement]) => current.replace(pattern, replacement),
        value,
    );

    return redacted.length > maxToolPayloadStringLength
        ? `${redacted.slice(0, maxToolPayloadStringLength)}... [truncated]`
        : redacted;
};

export const sanitizeToolPayload = (value: unknown, depth = 0): unknown => {
    if (typeof value === 'string') {
        return sanitizeToolPayloadString(value);
    }

    if (value === null || typeof value !== 'object') {
        return value;
    }

    if (depth >= 4) {
        return '[truncated:depth]';
    }

    if (Array.isArray(value)) {
        return value.slice(0, maxToolPayloadArrayItems).map((item) => sanitizeToolPayload(item, depth + 1));
    }

    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .slice(0, maxToolPayloadObjectKeys)
        .map(([key, item]) => [
            key,
            sensitiveToolPayloadKeyPattern.test(key) ? '[redacted]' : sanitizeToolPayload(item, depth + 1),
        ]));
};

export const sanitizeToolArgs = (args: Record<string, unknown>) => sanitizeToolPayload(args) as Record<string, unknown>;
export const sanitizeRuntimeErrorMessage = (error: unknown) => sanitizeToolPayload(error instanceof Error ? error.message : String(error)) as string;
export const sanitizePromptSnapshot = (prompt: string) => sanitizeToolPayloadString(prompt);

const sanitizeOptionalStringArray = (value: unknown) => (
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map(sanitizeToolPayloadString) : undefined
);

const sanitizeDataProvenanceItem = (item: Record<string, unknown>, fallback: { fetchedAt: string | null; isError?: boolean; sourceId: string }): DataProvenance => ({
    cacheStatus: item.cacheStatus === 'hit' || item.cacheStatus === 'miss' || item.cacheStatus === 'stale' ? item.cacheStatus : undefined,
    expectedRows: typeof item.expectedRows === 'number' || item.expectedRows === null ? item.expectedRows : undefined,
    fallbackProviderIds: sanitizeOptionalStringArray(item.fallbackProviderIds),
    fetchedAt: typeof item.fetchedAt === 'string' ? sanitizeToolPayloadString(item.fetchedAt) : fallback.fetchedAt,
    providerIds: sanitizeOptionalStringArray(item.providerIds),
    qualityStatus: item.qualityStatus === 'pass' || item.qualityStatus === 'warn' || item.qualityStatus === 'block' ? item.qualityStatus : fallback.isError ? 'block' : 'warn',
    rowsUsed: typeof item.rowsUsed === 'number' || item.rowsUsed === null ? item.rowsUsed : undefined,
    sourceId: typeof item.sourceId === 'string' ? sanitizeToolPayloadString(item.sourceId) : fallback.sourceId,
    sourcePriority: sanitizeOptionalStringArray(item.sourcePriority),
    warnings: sanitizeOptionalStringArray(item.warnings) ?? [],
});

const sanitizeDataProvenanceList = (items: DataProvenance[], fallbackSourceId: string) => items.map((item) => sanitizeDataProvenanceItem(
    item as unknown as Record<string, unknown>,
    { fetchedAt: item.fetchedAt, sourceId: fallbackSourceId },
));

export const sanitizeResearcherOutput = (output: ResearcherOutput, role: ResearchRole): ResearcherOutput => ({
    ...output,
    assumptions: output.assumptions.map(sanitizeToolPayloadString),
    conclusion: sanitizeToolPayloadString(output.conclusion),
    dataGaps: output.dataGaps.map(sanitizeToolPayloadString),
    dataProvenance: sanitizeDataProvenanceList(output.dataProvenance, `pi.${role}`),
    evidence: output.evidence.map((item) => ({
        label: sanitizeToolPayloadString(item.label),
        provenance: sanitizeDataProvenanceList(item.provenance, `pi.${role}`),
        summary: sanitizeToolPayloadString(item.summary),
    })),
    invalidationConditions: output.invalidationConditions.map(sanitizeToolPayloadString),
    risks: output.risks.map(sanitizeToolPayloadString),
});

export const buildToolExecutionDataProvenance = (payload: ResearchToolExecutionArtifact): DataProvenance[] => {
    if (isRecord(payload.result) && Array.isArray(payload.result.dataProvenance)) {
        return payload.result.dataProvenance.filter(isRecord).map((item) => sanitizeDataProvenanceItem(item, {
            fetchedAt: payload.completedAt,
            isError: payload.isError,
            sourceId: `pi.${payload.toolName}`,
        }));
    }

    return [{
        fetchedAt: payload.completedAt,
        qualityStatus: payload.isError ? 'block' : 'warn',
        sourceId: `pi.${payload.toolName}`,
        warnings: payload.isError ? [sanitizeToolPayloadString(payload.errorMessage ?? 'Agent tool execution failed.')] : [],
    }];
};