import type {
    DecisionCard,
    ResearchContextSnapshotArtifact,
    ResearchRemediationItem,
    ResearchTaskRoute,
    ResearchToolExecutionArtifact,
    ResearcherFailureArtifact,
    ResearcherOutput,
    ReviewGateResult,
} from '@quantdesk/shared';

const severityRank = { block: 3, warn: 2, info: 1 } as const;

const uniqById = (items: ResearchRemediationItem[]) => {
    const deduped = new Map<string, ResearchRemediationItem>();

    for (const item of items) {
        const existing = deduped.get(item.id);

        if (!existing || severityRank[item.severity] > severityRank[existing.severity]) {
            deduped.set(item.id, item);
        }
    }

    return Array.from(deduped.values());
};

const actionCeilingForSeverity = (severity: ResearchRemediationItem['severity']) => (
    severity === 'block' ? 'observe' : severity === 'warn' ? 'prepare' : undefined
);

const itemId = (...parts: Array<string | null | undefined>) => parts.filter(Boolean).join(':');

export const buildResearchRemediationItems = ({
    context,
    decisionCard,
    failures = [],
    gates = [],
    outputs = [],
    route,
    toolExecutions = [],
}: {
    context?: ResearchContextSnapshotArtifact;
    decisionCard?: DecisionCard;
    failures?: ResearcherFailureArtifact[];
    gates?: ReviewGateResult[];
    outputs?: ResearcherOutput[];
    route?: ResearchTaskRoute;
    toolExecutions?: Array<ResearchToolExecutionArtifact & { dataProvenance?: unknown[] }>;
}): ResearchRemediationItem[] => {
    const items: ResearchRemediationItem[] = [];

    for (const source of context?.dataSources ?? []) {
        if (source.status === 'available') {
            continue;
        }

        const isProvider = source.kind === 'provider';
        const providerIssue = source.status === 'unavailable' || source.status === 'contract';
        const severity = providerIssue || source.qualityStatus === 'block' ? 'block' : 'warn';

        items.push({
            blocksActionAbove: actionCeilingForSeverity(severity),
            category: isProvider ? 'provider_gap' : 'data_gap',
            id: itemId('source', source.id, source.status),
            nextAction: providerIssue
                ? `Connect or enable executable ${isProvider ? 'provider' : 'data'} coverage for ${source.label}.`
                : `Review degraded ${isProvider ? 'provider/tool' : 'local data'} coverage for ${source.label} before increasing action intensity.`,
            reasonCode: isProvider
                ? (providerIssue ? 'provider_source_unavailable' : 'provider_degraded')
                : source.id === 'local.risk_profile'
                    ? 'risk_profile_missing'
                    : source.id === 'local.daily_prices' || source.id === 'derived.price_signals'
                        ? 'price_history_missing'
                        : 'provider_degraded',
            severity,
            sourceId: source.id,
            summary: `${source.label}: ${source.status}/${source.qualityStatus}${source.warnings.length > 0 ? ` - ${source.warnings.join(' ')}` : ''}`,
        });
    }

    for (const omission of route?.notSummoned ?? []) {
        if (!omission.reason.startsWith('Required data sources for ')) {
            continue;
        }

        items.push({
            blocksActionAbove: 'prepare',
            category: 'route_omission',
            id: itemId('route', omission.role),
            nextAction: `Enable or repair the data sources required by ${omission.role}, then rerun that researcher.`,
            reasonCode: 'provider_source_unavailable',
            role: omission.role,
            severity: 'warn',
            summary: `${omission.role} was not summoned: ${omission.reason}`,
        });
    }

    for (const failure of failures) {
        const reasonCode = failure.reasonCode ?? 'runtime_failed';
        const severity = reasonCode === 'unauthorized_tool' || reasonCode === 'schema_invalid' ? 'block' : 'warn';

        items.push({
            blocksActionAbove: actionCeilingForSeverity(severity),
            category: reasonCode === 'unauthorized_tool' ? 'tool_policy' : 'runtime_failure',
            id: itemId('failure', failure.role, reasonCode, failure.attemptedToolName),
            nextAction: failure.remediation ?? `Rerun ${failure.role} after fixing runtime/provider diagnostics.`,
            reasonCode,
            role: failure.role,
            severity,
            summary: failure.attemptedToolName
                ? `${failure.role} attempted unauthorized tool ${failure.attemptedToolName}; allowed=${failure.allowedToolNames?.join(', ') || 'none'}.`
                : `${failure.role} failed: ${failure.error}`,
        });
    }

    for (const output of outputs) {
        if (output.dataProvenance.length === 0 && output.evidence.every((item) => item.provenance.length === 0)) {
            items.push({
                blocksActionAbove: 'observe',
                category: 'evidence_quality',
                id: itemId('provenance', output.role),
                nextAction: `Rerun ${output.role} with tool evidence or keep action at observe.`,
                reasonCode: 'missing_provenance',
                role: output.role,
                severity: 'block',
                summary: `${output.role} output has no verifiable provenance.`,
            });
        }

        if (output.repairMetadata?.schemaRepairApplied) {
            items.push({
                blocksActionAbove: 'prepare',
                category: 'schema_repair',
                id: itemId('schema', output.role),
                nextAction: `Rerun ${output.role} or force second review; repaired fields: ${output.repairMetadata.repairedFields.join(', ')}.`,
                reasonCode: 'schema_repair',
                role: output.role,
                severity: 'warn',
                summary: `${output.role} output required schema repair before it could be used.`,
            });
        }
    }

    for (const gate of gates) {
        gate.reasonCodes.forEach((reasonCode, index) => {
            if (reasonCode === 'researcher_runtime_failure') {
                return;
            }

            const severity = gate.status === 'block' ? 'block' : gate.status === 'warn' ? 'warn' : 'info';

            items.push({
                blocksActionAbove: actionCeilingForSeverity(severity),
                category: reasonCode.startsWith('provider') ? 'provider_gap' : 'data_gap',
                id: itemId('gate', gate.reviewerRole, reasonCode, String(index)),
                nextAction: gate.requiredDowngrades[index] ?? gate.requiredDowngrades[0] ?? `Review ${gate.reviewerRole} gate before action upgrade.`,
                reasonCode,
                role: gate.reviewerRole,
                severity,
                summary: gate.reasons[index] ?? gate.verdict,
            });
        });
    }

    for (const execution of toolExecutions) {
        if (execution.toolName === 'search_market_sources' || execution.toolName === 'search_announcements') {
            items.push({
                blocksActionAbove: 'observe',
                category: 'evidence_quality',
                id: itemId('source-fetch', execution.role, execution.toolCallId),
                nextAction: 'Fetch and parse the selected market source before using any snippet as factual evidence.',
                reasonCode: 'market_source_unfetched',
                role: execution.role,
                severity: 'warn',
                summary: `${execution.role}/${execution.toolName} returned source references only; snippets are not evidence.`,
            });
        }
    }

    if (decisionCard?.positionLevel === 'precise_unavailable') {
        items.push({
            blocksActionAbove: 'prepare',
            category: 'data_gap',
            id: 'decision:precise_unavailable',
            nextAction: 'Complete risk profile and sizing constraints before precise position sizing.',
            reasonCode: 'risk_profile_missing',
            severity: 'warn',
            summary: 'Decision card cannot produce precise sizing.',
        });
    }

    return uniqById(items);
};
