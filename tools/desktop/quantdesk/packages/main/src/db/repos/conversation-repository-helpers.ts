import type {
    AgentConversationRecord,
    AgentRunState,
    CompactionSnapshot,
    ConversationMessage,
    ConversationTitleSource,
    ConversationTitleStatus,
    ToolExecutionRecord,
} from '@quantdesk/shared';

import {
    defaultConversationTitleSource,
    defaultConversationTitleStatus,
} from '@quantdesk/shared';

import { parseJson } from '../json';

export interface ConversationRow {
    id: string;
    title: string | null;
    title_source: string | null;
    title_status: string | null;
    title_updated_at: string | null;
    messages: string;
    context: string;
    status: AgentRunState;
    degraded_mode: string | null;
    created_at: string;
    updated_at: string;
}

export interface MessageRow {
    id: string;
    conversation_id: string;
    seq: number;
    role: ConversationMessage['role'];
    content: string;
    metadata: string;
    tool_call_id: string | null;
    created_at: string;
}

export interface ToolExecutionRow {
    id: string;
    conversation_id: string;
    message_id: string;
    tool_name: string;
    input_json: string;
    output_json: string;
    error_json: string | null;
    status: ToolExecutionRecord['status'];
    duration_ms: number | null;
    token_count: number | null;
    created_at: string;
}

export interface CompactionSnapshotRow {
    id: string;
    conversation_id: string;
    summary_text: string;
    covered_message_ids: string;
    token_estimate: number | null;
    created_at: string;
}

export const mapMessageRow = (row: MessageRow): ConversationMessage => ({
    id: row.id,
    role: row.role,
    content: row.content,
    timestamp: row.created_at,
    toolCallId: row.tool_call_id ?? undefined,
    metadata: parseJson<Record<string, unknown>>(row.metadata),
});

export const mapToolExecutionRow = (row: ToolExecutionRow): ToolExecutionRecord => ({
    id: row.id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    toolName: row.tool_name,
    input: parseJson<unknown>(row.input_json),
    output: parseJson<unknown>(row.output_json),
    error: row.error_json ? parseJson<ToolExecutionRecord['error']>(row.error_json) : undefined,
    status: row.status,
    durationMs: row.duration_ms,
    tokenCount: row.token_count,
    createdAt: row.created_at,
});

export const mapCompactionSnapshotRow = (row: CompactionSnapshotRow): CompactionSnapshot => ({
    id: row.id,
    conversationId: row.conversation_id,
    summaryText: row.summary_text,
    coveredMessageIds: parseJson<string[]>(row.covered_message_ids),
    tokenEstimate: row.token_estimate,
    createdAt: row.created_at,
});

export const mapConversationRow = (
    row: ConversationRow,
    messages: ConversationMessage[],
): AgentConversationRecord => ({
    id: row.id,
    title: row.title,
    titleSource: (row.title_source ?? defaultConversationTitleSource) as ConversationTitleSource,
    titleStatus: (row.title_status ?? defaultConversationTitleStatus) as ConversationTitleStatus,
    titleUpdatedAt: row.title_updated_at,
    messages,
    context: parseJson<Record<string, unknown>>(row.context),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
});