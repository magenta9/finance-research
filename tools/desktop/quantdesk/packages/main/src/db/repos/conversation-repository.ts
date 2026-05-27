import crypto from 'node:crypto';

import type Database from 'better-sqlite3';

import type {
  AgentConversationInput,
  AgentConversationRecord,
  AgentRunState,
  CompactionSnapshot,
  ConversationMessage,
  ToolExecutionRecord,
} from '@quantdesk/shared';

import {
  defaultConversationTitleSource,
  defaultConversationTitleStatus,
} from '@quantdesk/shared';

import {
  type CompactionSnapshotRow,
  type ConversationRow,
  mapCompactionSnapshotRow,
  mapConversationRow,
  mapMessageRow,
  mapToolExecutionRow,
  type MessageRow,
  type ToolExecutionRow,
} from './conversation-repository-helpers';
import { parseJson, stringifyJson } from '../json';

export const createConversationRepository = (
  database: Database.Database,
) => {
  const getMessageRows = database.prepare(
    `
      SELECT id, conversation_id, seq, role, content, metadata, tool_call_id, created_at
      FROM conversation_messages
      WHERE conversation_id = ?
      ORDER BY seq ASC
    `,
  );

  const getConversationRowById = database.prepare(
    `
      SELECT *
      FROM agent_conversations
      WHERE id = ?
    `,
  );

  const getMaxSeq = database.prepare(
    `
      SELECT COALESCE(MAX(seq), -1) AS value
      FROM conversation_messages
      WHERE conversation_id = ?
    `,
  );

  const insertMessage = database.prepare(
    `
      INSERT INTO conversation_messages (id, conversation_id, seq, role, content, metadata, tool_call_id, created_at)
      VALUES (@id, @conversation_id, @seq, @role, @content, @metadata, @tool_call_id, @created_at)
    `,
  );

  const deleteMessages = database.prepare(
    `
      DELETE FROM conversation_messages
      WHERE conversation_id = ?
    `,
  );

  const updateConversationBlob = database.prepare(
    `
      UPDATE agent_conversations
      SET title = @title,
          title_source = @title_source,
          title_status = @title_status,
          title_updated_at = @title_updated_at,
          messages = @messages,
          context = @context,
          status = @status,
          degraded_mode = @degraded_mode,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `,
  );

  const listToolExecutionsStmt = database.prepare(
    `
      SELECT *
      FROM tool_executions
      WHERE conversation_id = ?
      ORDER BY created_at DESC, id DESC
    `,
  );

  const insertToolExecutionStmt = database.prepare(
    `
      INSERT INTO tool_executions (
        id,
        conversation_id,
        message_id,
        tool_name,
        input_json,
        output_json,
        error_json,
        status,
        duration_ms,
        token_count,
        created_at
      )
      VALUES (
        @id,
        @conversation_id,
        @message_id,
        @tool_name,
        @input_json,
        @output_json,
        @error_json,
        @status,
        @duration_ms,
        @token_count,
        @created_at
      )
    `,
  );

  const updateToolExecutionStmt = database.prepare(
    `
      UPDATE tool_executions
      SET output_json = @output_json,
          error_json = @error_json,
          status = @status,
          duration_ms = @duration_ms,
          token_count = @token_count
      WHERE id = @id
    `,
  );

  const getToolExecutionStmt = database.prepare(
    `
      SELECT *
      FROM tool_executions
      WHERE id = ?
    `,
  );

  const listCompactionSnapshotsStmt = database.prepare(
    `
      SELECT *
      FROM compaction_snapshots
      WHERE conversation_id = ?
      ORDER BY created_at DESC, id DESC
    `,
  );

  const insertCompactionSnapshotStmt = database.prepare(
    `
      INSERT INTO compaction_snapshots (
        id,
        conversation_id,
        summary_text,
        covered_message_ids,
        token_estimate,
        created_at
      )
      VALUES (
        @id,
        @conversation_id,
        @summary_text,
        @covered_message_ids,
        @token_estimate,
        @created_at
      )
    `,
  );

  const listConversationRows = database.prepare(
    `
      SELECT *
      FROM agent_conversations
      ORDER BY updated_at DESC, created_at DESC
    `,
  );

  const countNormalizedMessages = database.prepare(
    `
      SELECT COUNT(*) AS count
      FROM conversation_messages
      WHERE conversation_id = ?
    `,
  );

  const loadMessages = (conversationId: string) =>
    (getMessageRows.all(conversationId) as MessageRow[]).map(mapMessageRow);

  const syncConversationBlob = (id: string) => {
    const row = getConversationRowById.get(id) as ConversationRow | undefined;

    if (!row) {
      throw new Error(`Conversation ${id} was not found.`);
    }

    const messages = loadMessages(id);

    updateConversationBlob.run({
      id,
      title: row.title,
      title_source: row.title_source ?? defaultConversationTitleSource,
      title_status: row.title_status ?? defaultConversationTitleStatus,
      title_updated_at: row.title_updated_at,
      messages: stringifyJson(messages),
      context: row.context,
      status: row.status,
      degraded_mode: null,
    });
  };

  const backfillNormalizedMessages = database.transaction(() => {
    const rows = listConversationRows.all() as ConversationRow[];

    for (const row of rows) {
      const count = countNormalizedMessages.get(row.id) as { count: number };

      if (count.count > 0) {
        continue;
      }

      const messages = parseJson<ConversationMessage[]>(row.messages);

      messages.forEach((message, index) => {
        insertMessage.run({
          id: message.id ?? `${row.id}:legacy:${index}`,
          conversation_id: row.id,
          seq: index,
          role: message.role,
          content: message.content,
          metadata: stringifyJson(message.metadata ?? {}),
          tool_call_id: message.toolCallId ?? null,
          created_at: message.timestamp ?? row.created_at,
        });
      });
    }
  });

  backfillNormalizedMessages();

  const getById = (id: string) => {
    const row = getConversationRowById.get(id) as ConversationRow | undefined;

    return row ? mapConversationRow(row, loadMessages(id)) : null;
  };

  const appendMessages = (id: string, messages: ConversationMessage[]) => {
    const conversation = getById(id);

    if (!conversation) {
      throw new Error(`Conversation ${id} was not found.`);
    }

    const currentMaxSeq = (getMaxSeq.get(id) as { value: number }).value;
    const startedAt = new Date().toISOString();

    const transaction = database.transaction(() => {
      messages.forEach((message, index) => {
        insertMessage.run({
          id: message.id ?? crypto.randomUUID(),
          conversation_id: id,
          seq: currentMaxSeq + index + 1,
          role: message.role,
          content: message.content,
          metadata: stringifyJson(message.metadata ?? {}),
          tool_call_id: message.toolCallId ?? null,
          created_at: message.timestamp ?? startedAt,
        });
      });

      syncConversationBlob(id);
    });

    transaction();

    return getById(id) as AgentConversationRecord;
  };

  const replaceMessages = (id: string, messages: ConversationMessage[]) => {
    const conversation = getById(id);

    if (!conversation) {
      throw new Error(`Conversation ${id} was not found.`);
    }

    const transaction = database.transaction(() => {
      deleteMessages.run(id);
      messages.forEach((message, index) => {
        insertMessage.run({
          id: message.id ?? crypto.randomUUID(),
          conversation_id: id,
          seq: index,
          role: message.role,
          content: message.content,
          metadata: stringifyJson(message.metadata ?? {}),
          tool_call_id: message.toolCallId ?? null,
          created_at: message.timestamp ?? new Date().toISOString(),
        });
      });

      syncConversationBlob(id);
    });

    transaction();

    return getById(id) as AgentConversationRecord;
  };

  const updateContext = (id: string, context: Record<string, unknown>) => {
    const conversation = getById(id);

    if (!conversation) {
      throw new Error(`Conversation ${id} was not found.`);
    }

    database
      .prepare(
        `
          UPDATE agent_conversations
          SET context = @context,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = @id
        `,
      )
      .run({
        id,
        context: stringifyJson(context),
      });

    syncConversationBlob(id);

    return getById(id) as AgentConversationRecord;
  };

  const setStatus = (id: string, status: AgentRunState) => {
    const conversation = getById(id);

    if (!conversation) {
      throw new Error(`Conversation ${id} was not found.`);
    }

    database
      .prepare(
        `
          UPDATE agent_conversations
          SET status = @status,
              degraded_mode = @degraded_mode,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = @id
        `,
      )
      .run({
        id,
        status,
        degraded_mode: null,
      });

    syncConversationBlob(id);

    return getById(id) as AgentConversationRecord;
  };

  const updateTitle = (input: {
    id: string;
    title: string | null;
    titleSource: AgentConversationRecord['titleSource'];
    titleStatus: AgentConversationRecord['titleStatus'];
    titleUpdatedAt?: string | null;
  }) => {
    const conversation = getById(input.id);

    if (!conversation) {
      throw new Error(`Conversation ${input.id} was not found.`);
    }

    database
      .prepare(
        `
          UPDATE agent_conversations
          SET title = @title,
              title_source = @title_source,
              title_status = @title_status,
              title_updated_at = @title_updated_at,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = @id
        `,
      )
      .run({
        id: input.id,
        title: input.title,
        title_source: input.titleSource,
        title_status: input.titleStatus,
        title_updated_at: input.titleUpdatedAt ?? new Date().toISOString(),
      });

    syncConversationBlob(input.id);

    return getById(input.id) as AgentConversationRecord;
  };

  return {
    create(input: AgentConversationInput) {
      const transaction = database.transaction(() => {
        database
          .prepare(
            `
              INSERT INTO agent_conversations (
                id,
                title,
                title_source,
                title_status,
                title_updated_at,
                messages,
                context,
                status,
                degraded_mode
              )
              VALUES (
                @id,
                @title,
                @title_source,
                @title_status,
                @title_updated_at,
                @messages,
                @context,
                @status,
                @degraded_mode
              )
            `,
          )
          .run({
            id: input.id,
            title: input.title,
            title_source: input.titleSource ?? defaultConversationTitleSource,
            title_status: input.titleStatus ?? defaultConversationTitleStatus,
            title_updated_at: input.titleUpdatedAt ?? null,
            messages: stringifyJson(input.messages),
            context: stringifyJson(input.context),
            status: input.status ?? 'idle',
            degraded_mode: null,
          });

        input.messages.forEach((message, index) => {
          insertMessage.run({
            id: message.id ?? crypto.randomUUID(),
            conversation_id: input.id,
            seq: index,
            role: message.role,
            content: message.content,
            metadata: stringifyJson(message.metadata ?? {}),
            tool_call_id: message.toolCallId ?? null,
            created_at: message.timestamp ?? new Date().toISOString(),
          });
        });
      });

      transaction();

      return getById(input.id) as AgentConversationRecord;
    },
    appendMessage(id: string, message: AgentConversationInput['messages'][number]) {
      return appendMessages(id, [message]);
    },
    appendMessages,
    replaceMessages,
    updateTitle,
    updateContext,
    setStatus,
    listToolExecutions(conversationId: string) {
      return (listToolExecutionsStmt.all(conversationId) as ToolExecutionRow[]).map(mapToolExecutionRow);
    },
    createToolExecution(input: ToolExecutionRecord) {
      insertToolExecutionStmt.run({
        id: input.id,
        conversation_id: input.conversationId,
        message_id: input.messageId,
        tool_name: input.toolName,
        input_json: stringifyJson(input.input),
        output_json: stringifyJson(input.output),
        error_json: input.error ? stringifyJson(input.error) : null,
        status: input.status,
        duration_ms: input.durationMs,
        token_count: input.tokenCount,
        created_at: input.createdAt,
      });

      return mapToolExecutionRow(getToolExecutionStmt.get(input.id) as ToolExecutionRow);
    },
    updateToolExecution(id: string, patch: Partial<ToolExecutionRecord>) {
      const existing = getToolExecutionStmt.get(id) as ToolExecutionRow | undefined;

      if (!existing) {
        throw new Error(`Tool execution ${id} was not found.`);
      }

      updateToolExecutionStmt.run({
        id,
        output_json: stringifyJson(patch.output ?? parseJson<unknown>(existing.output_json)),
        error_json: patch.error
          ? stringifyJson(patch.error)
          : existing.error_json,
        status: patch.status ?? existing.status,
        duration_ms: patch.durationMs ?? existing.duration_ms,
        token_count: patch.tokenCount ?? existing.token_count,
      });

      return mapToolExecutionRow(getToolExecutionStmt.get(id) as ToolExecutionRow);
    },
    listCompactionSnapshots(conversationId: string) {
      return (listCompactionSnapshotsStmt.all(conversationId) as CompactionSnapshotRow[])
        .map(mapCompactionSnapshotRow);
    },
    createCompactionSnapshot(input: CompactionSnapshot) {
      insertCompactionSnapshotStmt.run({
        id: input.id,
        conversation_id: input.conversationId,
        summary_text: input.summaryText,
        covered_message_ids: stringifyJson(input.coveredMessageIds),
        token_estimate: input.tokenEstimate,
        created_at: input.createdAt,
      });

      return input;
    },
    getById,
    list() {
      const rows = listConversationRows.all() as ConversationRow[];

      return rows.map((row) => mapConversationRow(row, loadMessages(row.id)));
    },
    delete(id: string) {
      const result = database
        .prepare(
          `
            DELETE FROM agent_conversations
            WHERE id = ?
          `,
        )
        .run(id);

      return result.changes > 0;
    },
  };
};
