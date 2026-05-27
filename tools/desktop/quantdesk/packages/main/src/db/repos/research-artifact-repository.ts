import crypto from 'node:crypto';

import type Database from 'better-sqlite3';

import type {
    DataProvenance,
    PromptVersionManifestEntry,
    ResearchArtifactRecord,
    ResearchArtifactWriteInput,
    ResearchArtifactType,
    ResearchDataSourceStatus,
    ResearchRequestHistoryProjection,
    ResearchParticipantRole,
    ResearchRequestInput,
    ResearchRequestListQuery,
    ResearchRequestListResponse,
    ResearchRequestRecord,
    ResearchRequestSummary,
    ResearchRequestStatus,
} from '@quantdesk/shared';

import { parseJson, stringifyJson } from '../json';

interface ResearchRequestRow {
    completed_at: string | null;
    created_at: string;
    decision_card: string | null;
    error: string | null;
    id: string;
    input: string;
    normalized_request: string | null;
    preflight: string | null;
    report: string | null;
    route: string | null;
    runtime_mode: ResearchRequestRecord['runtimeMode'];
    status: ResearchRequestStatus;
    updated_at: string;
}

type ResearchRequestSummaryRow = Pick<
    ResearchRequestRow,
    'completed_at' | 'created_at' | 'decision_card' | 'error' | 'id' | 'input' | 'preflight' | 'runtime_mode' | 'status' | 'updated_at'
>;

type ResearchRequestSummaryWithProjectionRow = ResearchRequestSummaryRow & {
    history_projection: string | null;
};

interface ResearchArtifactRow {
    artifact_type: ResearchArtifactType;
    created_at: string;
    data_provenance: string;
    id: string;
    payload: string;
    prompt_version_manifest: string;
    request_id: string;
    role: ResearchParticipantRole | null;
}

const mapRequestRow = (row: ResearchRequestRow): ResearchRequestRecord => ({
    completedAt: row.completed_at,
    createdAt: row.created_at,
    decisionCard: row.decision_card ? parseJson<ResearchRequestRecord['decisionCard']>(row.decision_card) : null,
    error: row.error,
    id: row.id,
    input: parseJson<ResearchRequestInput>(row.input),
    normalizedRequest: row.normalized_request ? parseJson<ResearchRequestRecord['normalizedRequest']>(row.normalized_request) : null,
    preflight: row.preflight ? parseJson<ResearchRequestRecord['preflight']>(row.preflight) : null,
    report: row.report ? parseJson<ResearchRequestRecord['report']>(row.report) : null,
    route: row.route ? parseJson<ResearchRequestRecord['route']>(row.route) : null,
    runtimeMode: row.runtime_mode,
    status: row.status,
    updatedAt: row.updated_at,
});

const mapRequestSummaryRow = (row: ResearchRequestSummaryRow): ResearchRequestSummary => ({
    completedAt: row.completed_at,
    createdAt: row.created_at,
    decisionCard: row.decision_card ? parseJson<ResearchRequestSummary['decisionCard']>(row.decision_card) : null,
    error: row.error,
    id: row.id,
    input: parseJson<ResearchRequestInput>(row.input),
    preflight: row.preflight ? parseJson<ResearchRequestSummary['preflight']>(row.preflight) : null,
    runtimeMode: row.runtime_mode,
    status: row.status,
    updatedAt: row.updated_at,
});

const mapRequestSummaryWithProjectionRow = (row: ResearchRequestSummaryWithProjectionRow): ResearchRequestSummary => {
    const summary = mapRequestSummaryRow(row);

    return row.history_projection
        ? { ...summary, projection: parseJson<ResearchRequestHistoryProjection>(row.history_projection) }
        : summary;
};

const mapArtifactRow = (row: ResearchArtifactRow): ResearchArtifactRecord => ({
    artifactType: row.artifact_type,
    createdAt: row.created_at,
    dataProvenance: parseJson<DataProvenance[]>(row.data_provenance),
    id: row.id,
    payload: parseJson<unknown>(row.payload),
    promptVersionManifest: parseJson<PromptVersionManifestEntry[]>(row.prompt_version_manifest),
    requestId: row.request_id,
    role: row.role,
} as ResearchArtifactRecord);

const emptyDataSourceSummary = (): Record<ResearchDataSourceStatus, number> => ({
    available: 0,
    contract: 0,
    degraded: 0,
    unavailable: 0,
});

const buildHistoryProjection = (
    summary: ResearchRequestSummary,
    artifacts: ResearchArtifactRecord[],
): ResearchRequestHistoryProjection => {
    const gateArtifacts = artifacts.filter((artifact) => artifact.artifactType === 'review_gate');
    const contextArtifact = artifacts.find((artifact) => artifact.artifactType === 'context_snapshot');
    const routeArtifact = artifacts.find((artifact) => artifact.artifactType === 'route');
    const dataSources = contextArtifact?.artifactType === 'context_snapshot' && Array.isArray(contextArtifact.payload.dataSources)
        ? contextArtifact.payload.dataSources
        : [];
    const assets = contextArtifact?.artifactType === 'context_snapshot' && Array.isArray(contextArtifact.payload.assets)
        ? contextArtifact.payload.assets
        : [];
    const dataSourceSummary = dataSources.reduce((counts, source) => ({
        ...counts,
        [source.status]: counts[source.status] + 1,
    }), emptyDataSourceSummary());
    const researcherFailureCount = artifacts.filter((artifact) => artifact.artifactType === 'researcher_failure').length;
    const toolExecutionArtifacts = artifacts.filter((artifact) => artifact.artifactType === 'tool_execution');
    const toolExecutionCount = toolExecutionArtifacts.length;
    const failedToolExecutionCount = toolExecutionArtifacts.filter((artifact) => artifact.payload.isError).length;
    const dataGapCount = new Set([
        ...artifacts.flatMap((artifact) => artifact.artifactType === 'researcher_output' ? artifact.payload.dataGaps : []),
        ...(summary.decisionCard?.dataGaps ?? []),
    ]).size;
    const reviewTriggered = gateArtifacts.some((artifact) => artifact.role === 'devil_advocate')
        || artifacts.some((artifact) => artifact.artifactType === 'researcher_output' && artifact.payload.needsSecondReview);
    const runtimeMode = summary.runtimeMode
        ?? (toolExecutionCount > 0 || artifacts.some((artifact) => artifact.artifactType === 'researcher_failure' && artifact.payload.runtimeMode === 'pi') ? 'pi' : null);

    return {
        actionLevel: summary.decisionCard?.actionLevel ?? null,
        assetIds: Array.from(new Set([...(summary.input.assetIds ?? []), ...assets.map((asset) => asset.id)])),
        assetSymbols: Array.from(new Set(assets.flatMap((asset) => [asset.symbol, asset.name]))),
        blockedGateCount: gateArtifacts.filter((artifact) => artifact.payload.status === 'block').length,
        dataGapCount,
        dataSourceSummary,
        providerFailureCount: dataSourceSummary.unavailable + failedToolExecutionCount,
        researcherFailureCount,
        reviewTriggered,
        runtimeMode,
        taskType: routeArtifact?.artifactType === 'route' ? routeArtifact.payload.normalizedRequest.taskType : null,
        toolExecutionCount,
        warnedGateCount: gateArtifacts.filter((artifact) => artifact.payload.status === 'warn').length,
    };
};

const dataSourceStatusColumn: Record<ResearchDataSourceStatus, string> = {
    available: 'available_count',
    contract: 'contract_count',
    degraded: 'degraded_count',
    unavailable: 'unavailable_count',
};
const historyProjectionBackfillBatchSize = 100;

const createRequestSummaryWhereClause = (query: ResearchRequestListQuery) => {
    const clauses: string[] = [];
    const params: Record<string, unknown> = {};

    if (query.status) {
        clauses.push('r.status = @status');
        params.status = query.status;
    }

    if (query.runtimeMode) {
        clauses.push('COALESCE(hp.runtime_mode, r.runtime_mode) = @runtimeMode');
        params.runtimeMode = query.runtimeMode;
    }

    if (query.actionLevel) {
        clauses.push('hp.action_level = @actionLevel');
        params.actionLevel = query.actionLevel;
    }

    if (query.taskType) {
        clauses.push('hp.task_type = @taskType');
        params.taskType = query.taskType;
    }

    if (query.dataSourceStatus) {
        clauses.push(`hp.${dataSourceStatusColumn[query.dataSourceStatus]} > 0`);
    }

    if (query.gateStatus === 'block') {
        clauses.push('hp.blocked_gate_count > 0');
    }

    if (query.gateStatus === 'warn') {
        clauses.push('hp.warned_gate_count > 0');
    }

    if (query.gateStatus === 'pass') {
        clauses.push('COALESCE(hp.blocked_gate_count, 0) = 0 AND COALESCE(hp.warned_gate_count, 0) = 0');
    }

    if (query.hasResearcherFailure !== undefined) {
        clauses.push(query.hasResearcherFailure ? 'hp.researcher_failure_count > 0' : 'COALESCE(hp.researcher_failure_count, 0) = 0');
    }

    if (query.providerFailure !== undefined) {
        clauses.push(query.providerFailure ? 'hp.provider_failure_count > 0' : 'COALESCE(hp.provider_failure_count, 0) = 0');
    }

    if (query.reviewTriggered !== undefined) {
        clauses.push('COALESCE(hp.review_triggered, 0) = @reviewTriggered');
        params.reviewTriggered = query.reviewTriggered ? 1 : 0;
    }

    const targetText = query.targetText?.trim().toLocaleLowerCase();

    if (targetText) {
        clauses.push('LOWER(hp.target_text) LIKE @targetText');
        params.targetText = `%${targetText}%`;
    }

    const text = query.text?.trim().toLocaleLowerCase();

    if (text) {
        clauses.push('(LOWER(r.input) LIKE @text OR LOWER(COALESCE(r.error, \'\')) LIKE @text OR LOWER(COALESCE(r.decision_card, \'\')) LIKE @text)');
        params.text = `%${text}%`;
    }

    return {
        params,
        whereSql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    };
};

const createTargetSearchText = (summary: ResearchRequestSummary, projection: ResearchRequestHistoryProjection) => Array.from(new Set([
    summary.input.query,
    summary.input.unresolvedTarget ?? '',
    ...(summary.input.assetIds ?? []),
    ...projection.assetIds,
    ...projection.assetSymbols,
]))
    .join('\n')
    .toLocaleLowerCase();

export const createResearchArtifactRepository = (database: Database.Database) => {
    const listArtifactsByRequest = (requestId: string) => {
        const rows = database
            .prepare(
                `
            SELECT *
            FROM research_artifacts
            WHERE request_id = ?
            ORDER BY created_at ASC, id ASC
          `,
            )
            .all(requestId) as ResearchArtifactRow[];

        return rows.map(mapArtifactRow);
    };

    const getRequestById = (id: string) => {
        const row = database
            .prepare(
                `
          SELECT *
          FROM research_requests
          WHERE id = ?
        `,
            )
            .get(id) as ResearchRequestRow | undefined;

        return row ? mapRequestRow(row) : null;
    };

    const getRequestSummaryById = (id: string) => {
        const row = database
            .prepare(
                `
          SELECT id, input, status, runtime_mode, decision_card, preflight, error, completed_at, created_at, updated_at
          FROM research_requests
          WHERE id = ?
        `,
            )
            .get(id) as ResearchRequestSummaryRow | undefined;

        return row ? mapRequestSummaryRow(row) : null;
    };

    const upsertHistoryProjection = (requestId: string) => {
        const summary = getRequestSummaryById(requestId);

        if (!summary) {
            return;
        }

        const projection = buildHistoryProjection(summary, listArtifactsByRequest(requestId));

        database
            .prepare(
                `
          INSERT INTO research_request_history_projection (
            request_id,
            projection,
            action_level,
            task_type,
            runtime_mode,
            target_text,
            available_count,
            degraded_count,
            contract_count,
            unavailable_count,
            provider_failure_count,
            researcher_failure_count,
            review_triggered,
            blocked_gate_count,
            warned_gate_count,
            tool_execution_count,
            data_gap_count,
            updated_at
          )
          VALUES (
            @requestId,
            @projection,
            @actionLevel,
            @taskType,
            @runtimeMode,
            @targetText,
            @availableCount,
            @degradedCount,
            @contractCount,
            @unavailableCount,
            @providerFailureCount,
            @researcherFailureCount,
            @reviewTriggered,
            @blockedGateCount,
            @warnedGateCount,
            @toolExecutionCount,
            @dataGapCount,
            CURRENT_TIMESTAMP
          )
          ON CONFLICT(request_id) DO UPDATE SET
            projection = excluded.projection,
            action_level = excluded.action_level,
            task_type = excluded.task_type,
            runtime_mode = excluded.runtime_mode,
            target_text = excluded.target_text,
            available_count = excluded.available_count,
            degraded_count = excluded.degraded_count,
            contract_count = excluded.contract_count,
            unavailable_count = excluded.unavailable_count,
            provider_failure_count = excluded.provider_failure_count,
            researcher_failure_count = excluded.researcher_failure_count,
            review_triggered = excluded.review_triggered,
            blocked_gate_count = excluded.blocked_gate_count,
            warned_gate_count = excluded.warned_gate_count,
            tool_execution_count = excluded.tool_execution_count,
            data_gap_count = excluded.data_gap_count,
            updated_at = CURRENT_TIMESTAMP
        `,
            )
            .run({
                actionLevel: projection.actionLevel,
                availableCount: projection.dataSourceSummary.available,
                blockedGateCount: projection.blockedGateCount,
                contractCount: projection.dataSourceSummary.contract,
                dataGapCount: projection.dataGapCount,
                degradedCount: projection.dataSourceSummary.degraded,
                projection: stringifyJson(projection),
                providerFailureCount: projection.providerFailureCount,
                requestId,
                researcherFailureCount: projection.researcherFailureCount,
                reviewTriggered: projection.reviewTriggered ? 1 : 0,
                runtimeMode: projection.runtimeMode,
                targetText: createTargetSearchText(summary, projection),
                taskType: projection.taskType,
                toolExecutionCount: projection.toolExecutionCount,
                unavailableCount: projection.dataSourceSummary.unavailable,
                warnedGateCount: projection.warnedGateCount,
            });
    };

    const backfillMissingHistoryProjections = () => {
        let backfilledRowCount = historyProjectionBackfillBatchSize;

        while (backfilledRowCount === historyProjectionBackfillBatchSize) {
            const rows = database
                .prepare(
                    `
          SELECT r.id
          FROM research_requests r
          LEFT JOIN research_request_history_projection hp ON hp.request_id = r.id
          WHERE hp.request_id IS NULL
                    ORDER BY r.updated_at DESC, r.created_at DESC, r.id DESC
                    LIMIT ?
        `,
                )
                .all(historyProjectionBackfillBatchSize) as Array<{ id: string }>;

            backfilledRowCount = rows.length;

            for (const row of rows) {
                upsertHistoryProjection(row.id);
            }
        }
    };

    return {
        createRequest(input: {
            id: string;
            request: ResearchRequestInput;
            status: ResearchRequestStatus;
        }) {
            return database.transaction(() => {
                database
                    .prepare(
                        `
            INSERT INTO research_requests (id, input, status)
            VALUES (@id, @input, @status)
          `,
                    )
                    .run({
                        id: input.id,
                        input: stringifyJson(input.request),
                        status: input.status,
                    });

                upsertHistoryProjection(input.id);

                return getRequestById(input.id) as ResearchRequestRecord;
            })();
        },
        getRequestById,
        backfillMissingHistoryProjections,
        listRequests() {
            const rows = database
                .prepare(
                    `
            SELECT *
            FROM research_requests
            ORDER BY updated_at DESC, created_at DESC
          `,
                )
                .all() as ResearchRequestRow[];

            return rows.map(mapRequestRow);
        },
        listRequestSummaries(query: ResearchRequestListQuery = {}): ResearchRequestListResponse {
            const limit = Math.min(Math.max(Math.trunc(query.limit ?? 30), 1), 100);
            const offset = Math.max(Math.trunc(query.offset ?? 0), 0);
            const { params, whereSql } = createRequestSummaryWhereClause(query);
            const rows = database
                .prepare(
                    `
            SELECT
              r.id,
              r.input,
              r.status,
              r.runtime_mode,
              r.decision_card,
              r.preflight,
              r.error,
              r.completed_at,
              r.created_at,
              r.updated_at,
              hp.projection AS history_projection
            FROM research_requests r
            LEFT JOIN research_request_history_projection hp ON hp.request_id = r.id
            ${whereSql}
            ORDER BY r.updated_at DESC, r.created_at DESC, r.id DESC
            LIMIT @limit OFFSET @offset
          `,
                )
                .all({ ...params, limit, offset }) as ResearchRequestSummaryWithProjectionRow[];
            const totalRow = database
                .prepare(
                    `
            SELECT COUNT(*) AS count
            FROM research_requests r
            LEFT JOIN research_request_history_projection hp ON hp.request_id = r.id
            ${whereSql}
          `,
                )
                .get(params) as { count: number };
            const items = rows.map(mapRequestSummaryWithProjectionRow);
            const nextOffset = offset + rows.length < totalRow.count ? offset + rows.length : null;

            return {
                items,
                nextOffset,
                total: totalRow.count,
            };
        },
        updateRequest(
            id: string,
            patch: Partial<Pick<ResearchRequestRecord, 'completedAt' | 'decisionCard' | 'error' | 'normalizedRequest' | 'preflight' | 'report' | 'route' | 'runtimeMode' | 'status'>>,
        ) {
            const existing = getRequestById(id);

            if (!existing) {
                throw new Error(`Research request ${id} was not found.`);
            }

            return database.transaction(() => {
                database
                    .prepare(
                        `
            UPDATE research_requests
            SET status = @status,
                normalized_request = @normalizedRequest,
                route = @route,
                runtime_mode = @runtimeMode,
                preflight = @preflight,
                decision_card = @decisionCard,
                report = @report,
                error = @error,
                completed_at = @completedAt,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = @id
          `,
                    )
                    .run({
                        completedAt: patch.completedAt ?? existing.completedAt,
                        decisionCard: patch.decisionCard ? stringifyJson(patch.decisionCard) : existing.decisionCard ? stringifyJson(existing.decisionCard) : null,
                        error: patch.error ?? existing.error,
                        id,
                        normalizedRequest: patch.normalizedRequest ? stringifyJson(patch.normalizedRequest) : existing.normalizedRequest ? stringifyJson(existing.normalizedRequest) : null,
                        preflight: patch.preflight ? stringifyJson(patch.preflight) : existing.preflight ? stringifyJson(existing.preflight) : null,
                        report: patch.report ? stringifyJson(patch.report) : existing.report ? stringifyJson(existing.report) : null,
                        route: patch.route ? stringifyJson(patch.route) : existing.route ? stringifyJson(existing.route) : null,
                        runtimeMode: patch.runtimeMode ?? existing.runtimeMode,
                        status: patch.status ?? existing.status,
                    });

                upsertHistoryProjection(id);

                return getRequestById(id) as ResearchRequestRecord;
            })();
        },
        deleteRequest(id: string) {
            const result = database
                .prepare(
                    `
            DELETE FROM research_requests
            WHERE id = ?
          `,
                )
                .run(id);

            return result.changes > 0;
        },
        saveArtifact(input: ResearchArtifactWriteInput) {
            const id = input.id ?? crypto.randomUUID();

            return database.transaction(() => {
                database
                    .prepare(
                        `
            INSERT INTO research_artifacts (
              id,
              request_id,
              artifact_type,
              role,
              payload,
              prompt_version_manifest,
              data_provenance
            )
            VALUES (
              @id,
              @requestId,
              @artifactType,
              @role,
              @payload,
              @promptVersionManifest,
              @dataProvenance
            )
          `,
                    )
                    .run({
                        artifactType: input.artifactType,
                        dataProvenance: stringifyJson(input.dataProvenance),
                        id,
                        payload: stringifyJson(input.payload),
                        promptVersionManifest: stringifyJson(input.promptVersionManifest),
                        requestId: input.requestId,
                        role: input.role,
                    });

                upsertHistoryProjection(input.requestId);

                const row = database
                    .prepare(
                        `
            SELECT *
            FROM research_artifacts
            WHERE id = ?
          `,
                    )
                    .get(id) as ResearchArtifactRow;

                return mapArtifactRow(row);
            })();
        },
        listArtifactsByRequest,
    };
};