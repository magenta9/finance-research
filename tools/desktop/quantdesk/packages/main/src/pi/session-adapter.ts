import type {
  AssistantContentProjection,
  PiRiskGateState,
  ConversationTitleSource,
  ConversationTitleStatus,
  PiItemEvent,
  PiToolCallLifecycleItem,
  PiAgentStreamEvent,
  PiRunStatus,
  PiSessionRecord,
  PiSessionSummary,
  PiSessionTranscript as SharedPiSessionTranscript,
  PiToolStep,
  ToolCallBlock,
  ToolExecutionError,
} from '@quantdesk/shared';
import {
  appendProjectionMessage,
  buildPiAssistantSegmentItemId,
  buildPiWorkUnitId,
  createEmptyAssistantContentProjection,
  reducePiItemEvents,
} from '@quantdesk/shared';

import type { PiManagerSessionRunStatus } from './run-status-store';
import { getPreferredPiToolInvocationError } from './error-normalization';
import { resolveLastToolName, resolveRunStatus, summarizeUnknown } from './session-run-status';
import type {
  PiRuntimeStatus,
  PiWrapperSessionSummary as InternalPiSessionSummary,
  PiWrapperSessionTranscript,
  PiStreamEvent,
  PiToolInvocation,
  PiToolInvocationError,
} from './types';

interface PiSessionAccess {
  getRiskGateState(): PiRiskGateState;
  getSessionRunStatus(sessionId: string): PiManagerSessionRunStatus | null;
  getStatus(): Promise<PiRuntimeStatus>;
  getSessionTranscript(sessionId: string): Promise<PiWrapperSessionTranscript>;
  listSessions(): Promise<InternalPiSessionSummary[]>;
  listToolInvocations(sessionId: string): Promise<PiToolInvocation[]>;
}

interface PiLiveNarrativeItemState {
  assistantSegmentId?: string | null;
  createdAt: string;
  itemId: string;
  kind: 'assistant_message' | 'reasoning';
  runId: string;
}

interface PiLiveToolItemState {
  createdAt: string;
  input: Record<string, unknown>;
  itemId: string;
  runId: string;
  sessionId: string;
  startedAt: string;
  toolCallId: string;
  toolName: string;
}

interface PiLiveRunProjectionState {
  activeNarrativeItem: PiLiveNarrativeItemState | null;
  assistantSegmentCount: number;
  reasoningCount: number;
  toolItems: Map<string, PiLiveToolItemState>;
}

const mapToolError = (error: PiToolInvocationError | null): ToolExecutionError | null => {
  if (!error) {
    return null;
  }

  return {
    code: error.code ?? 'PI_TOOL_ERROR',
    message: error.message,
  };
};

const deriveDurationMs = (startedAt: string | null | undefined, finishedAt: string | null | undefined) => {
  if (!startedAt || !finishedAt) {
    return null;
  }

  const start = Date.parse(startedAt);
  const finish = Date.parse(finishedAt);

  if (Number.isNaN(start) || Number.isNaN(finish)) {
    return null;
  }

  return Math.max(0, finish - start);
};

const toObjectRecord = (value: unknown) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (value == null) {
    return {};
  }

  return { value };
};

const toToolBlockStatus = (status: PiToolInvocation['status']) => {
  switch (status) {
    case 'success':
      return 'complete' as const;
    case 'error':
      return 'error' as const;
    case 'cancelled':
      return 'cancelled' as const;
    case 'running':
      return 'running' as const;
  }
};

const buildApprovalBlock = (
  sessionId: string,
  runStatus: PiRunStatus,
  riskGateState: PiRiskGateState,
): ToolCallBlock | null => {
  if (!riskGateState.required) {
    return null;
  }

  return {
    id: `approval:${sessionId}:high-privilege`,
    input: {
      message: riskGateState.message,
      required: riskGateState.required,
      riskLevel: riskGateState.riskLevel,
    },
    output: riskGateState.acknowledged
      ? {
        content: riskGateState.message,
        summary: '已确认高权限风险。',
      }
      : undefined,
    startedAt: runStatus.updatedAt,
    status: riskGateState.acknowledged ? 'approved' : 'requires_approval',
    toolLabel: '高权限风险确认',
    toolName: 'high_privilege_risk',
    type: 'tool_call',
  };
};

const getTranscriptMessageTimestamp = (message: PiWrapperSessionTranscript['messages'][number]) => {
  const raw = message.raw && typeof message.raw === 'object' ? message.raw as Record<string, unknown> : null;
  const nested = raw?.message && typeof raw.message === 'object' ? raw.message as Record<string, unknown> : null;
  const candidates = [
    raw?.timestamp,
    raw?.createdAt,
    raw?.updatedAt,
    nested?.timestamp,
    nested?.createdAt,
    nested?.updatedAt,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
  }

  return null;
};

const toProjectionMessage = (message: PiWrapperSessionTranscript['messages'][number]) => ({
  content: message.content,
  createdAt: getTranscriptMessageTimestamp(message),
  id: message.id,
  role: message.role,
  sourceMessageId: message.id,
});

const buildReplayReasoningEvents = (
  message: PiWrapperSessionTranscript['messages'][number],
  status: 'cancelled' | 'complete' | 'streaming',
): PiItemEvent[] => {
  const createdAt = getTranscriptMessageTimestamp(message);
  const itemId = buildPiWorkUnitId({
    kind: 'reasoning',
    sourceMessageId: message.id,
  });
  const summary = message.content.trim().split(/\r?\n/, 1)[0] ?? '';

  return [
    {
      data: {
        createdAt,
        itemId,
        kind: 'reasoning',
        sourceMessageId: message.id,
        status: message.isError ? 'cancelled' : 'streaming',
        summary: summary.trim().length > 0 ? summary.trim() : undefined,
      },
      event: 'item.started',
    },
    {
      data: {
        contentKind: 'reasoning',
        delta: message.content,
        itemId,
      },
      event: 'content.delta',
    },
    {
      data: {
        createdAt,
        itemId,
        kind: 'reasoning',
        sourceMessageId: message.id,
        status: message.isError ? 'cancelled' : status,
        summary: summary.trim().length > 0 ? summary.trim() : undefined,
      },
      event: 'item.completed',
    },
  ];
};

const buildReplayAssistantEvents = (
  message: PiWrapperSessionTranscript['messages'][number],
  status: 'cancelled' | 'complete' | 'error' | 'streaming',
): PiItemEvent[] => {
  const createdAt = getTranscriptMessageTimestamp(message);
  const itemId = buildPiAssistantSegmentItemId({
    assistantSegmentId: null,
    messageId: message.id,
  });

  return [
    {
      data: {
        createdAt,
        itemId,
        kind: 'assistant_message',
        sourceMessageId: message.id,
        status: 'streaming',
      },
      event: 'item.started',
    },
    {
      data: {
        contentKind: 'assistant_text',
        delta: message.content,
        itemId,
      },
      event: 'content.delta',
    },
    {
      data: {
        createdAt,
        itemId,
        kind: 'assistant_message',
        sourceMessageId: message.id,
        status: message.isError ? 'error' : status,
      },
      event: 'item.completed',
    },
  ];
};

const buildReplayToolEvents = (
  invocation: PiToolInvocation,
  sourceMessageId?: string,
): PiItemEvent[] => {
  const itemId = buildPiWorkUnitId({
    kind: 'tool_call',
    runId: invocation.runId,
    toolCallId: invocation.toolCallId,
  });
  const baseItem = {
    createdAt: invocation.startedAt,
    input: toObjectRecord(invocation.args),
    itemId,
    kind: 'tool_call' as const,
    runId: invocation.runId,
    sourceMessageId: sourceMessageId ?? invocation.toolCallId,
    startedAt: invocation.startedAt,
    status: 'running' as const,
    toolLabel: invocation.toolName,
    toolName: invocation.toolName,
  };
  const events: PiItemEvent[] = [
    {
      data: baseItem,
      event: 'item.started',
    },
  ];
  const outputContent = invocation.status === 'running'
    ? summarizeUnknown(invocation.partialResult)
    : summarizeUnknown(invocation.result);
  const summary = getPreferredPiToolInvocationError(invocation)?.message
    ?? invocation.summary
    ?? outputContent
    ?? null;

  if (outputContent || summary || invocation.status === 'running') {
    events.push({
      data: {
        ...baseItem,
        durationMs: deriveDurationMs(invocation.startedAt, invocation.finishedAt),
        errorMessage: getPreferredPiToolInvocationError(invocation)?.message ?? null,
        finishedAt: invocation.finishedAt,
        output: outputContent || summary
          ? {
            content: outputContent ?? undefined,
            summary: summary ?? outputContent ?? `${invocation.toolName} 已返回结果。`,
          }
          : undefined,
        status: invocation.status === 'running' ? 'running' : toToolBlockStatus(invocation.status),
      },
      event: 'item.updated',
    });
  }

  if (invocation.status !== 'running') {
    events.push({
      data: {
        ...baseItem,
        durationMs: deriveDurationMs(invocation.startedAt, invocation.finishedAt),
        errorMessage: getPreferredPiToolInvocationError(invocation)?.message ?? null,
        finishedAt: invocation.finishedAt,
        output: outputContent || summary
          ? {
            content: outputContent ?? undefined,
            summary: summary ?? outputContent ?? `${invocation.toolName} 已返回结果。`,
          }
          : undefined,
        status: toToolBlockStatus(invocation.status),
      },
      event: 'item.completed',
    });
  }

  return events;
};

const buildPiProjection = ({
  runStatus,
  riskGateState,
  sessionId,
  toolInvocations,
  transcript,
}: {
  runStatus: PiRunStatus;
  riskGateState: PiRiskGateState;
  sessionId: string;
  toolInvocations: PiToolInvocation[];
  transcript: PiWrapperSessionTranscript;
}): AssistantContentProjection => {
  const toolInvocationByCallId = new Map(toolInvocations.map((invocation) => [invocation.toolCallId, invocation]));
  const consumedToolCallIds = new Set<string>();
  const lastNarrativeMessage = [...transcript.messages].reverse().find((message) => message.role === 'assistant') ?? null;
  let projection = createEmptyAssistantContentProjection();

  for (const message of transcript.messages) {
    if (message.role === 'user') {
      projection = appendProjectionMessage(projection, toProjectionMessage(message));
      continue;
    }

    if (message.role === 'assistant') {
      const isActiveNarrativeMessage = Boolean(
        lastNarrativeMessage
        && lastNarrativeMessage.id === message.id
        && lastNarrativeMessage.phase === message.phase,
      );
      const itemEvents = message.phase === 'thinking'
        ? buildReplayReasoningEvents(message, runStatus.state === 'running' && isActiveNarrativeMessage ? 'streaming' : 'complete')
        : buildReplayAssistantEvents(message, (() => {
          if (message.isError) {
            return 'error' as const;
          }

          if (runStatus.state === 'running' && isActiveNarrativeMessage) {
            return 'streaming' as const;
          }

          if (runStatus.state === 'cancelled' && isActiveNarrativeMessage) {
            return 'cancelled' as const;
          }

          return 'complete' as const;
        })());
      projection = reducePiItemEvents(projection, itemEvents);
      continue;
    }

    if (message.toolCallId) {
      const invocation = toolInvocationByCallId.get(message.toolCallId);

      if (invocation) {
        consumedToolCallIds.add(invocation.toolCallId);
        projection = reducePiItemEvents(projection, buildReplayToolEvents(invocation, message.id));
      }

      continue;
    }

    projection = appendProjectionMessage(projection, toProjectionMessage(message));
  }

  toolInvocations
    .filter((invocation) => !consumedToolCallIds.has(invocation.toolCallId))
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
    .forEach((invocation) => {
      projection = reducePiItemEvents(projection, buildReplayToolEvents(invocation));
    });

  return {
    ...projection,
    approvalBlock: buildApprovalBlock(sessionId, runStatus, riskGateState),
  };
};

const createLiveRunProjectionState = (): PiLiveRunProjectionState => ({
  activeNarrativeItem: null,
  assistantSegmentCount: 0,
  reasoningCount: 0,
  toolItems: new Map(),
});

const buildNarrativeCompletionEvent = (
  item: PiLiveNarrativeItemState,
  status: 'cancelled' | 'complete' | 'error',
): PiItemEvent => ({
  data: item.kind === 'reasoning'
    ? {
      createdAt: item.createdAt,
      itemId: item.itemId,
      kind: 'reasoning',
      runId: item.runId,
      status: status === 'error' ? 'cancelled' : status,
    }
    : {
      assistantSegmentId: item.assistantSegmentId ?? null,
      createdAt: item.createdAt,
      itemId: item.itemId,
      kind: 'assistant_message',
      runId: item.runId,
      status,
    },
  event: 'item.completed',
});

const closeActiveNarrativeItem = (
  liveState: PiLiveRunProjectionState,
  status: 'cancelled' | 'complete' | 'error',
) => {
  if (!liveState.activeNarrativeItem) {
    return [] as PiItemEvent[];
  }

  const event = buildNarrativeCompletionEvent(liveState.activeNarrativeItem, status);
  liveState.activeNarrativeItem = null;
  return [event];
};

const buildLiveMessageDeltaEvents = (
  event: Extract<PiStreamEvent, { type: 'message_delta' }>,
  liveState: PiLiveRunProjectionState,
) => {
  const itemEvents: PiItemEvent[] = [];

  if (event.phase === 'thinking') {
    if (liveState.activeNarrativeItem?.kind !== 'reasoning') {
      itemEvents.push(...closeActiveNarrativeItem(liveState, 'complete'));
      const itemId = buildPiWorkUnitId({
        index: liveState.reasoningCount,
        kind: 'reasoning',
        runId: event.runId,
      });
      liveState.reasoningCount += 1;
      liveState.activeNarrativeItem = {
        createdAt: event.timestamp,
        itemId,
        kind: 'reasoning',
        runId: event.runId,
      };
      itemEvents.push({
        data: {
          createdAt: event.timestamp,
          itemId,
          kind: 'reasoning',
          runId: event.runId,
          status: 'streaming',
        },
        event: 'item.started',
      });
    }

    itemEvents.push({
      data: {
        contentKind: 'reasoning',
        delta: event.delta,
        itemId: liveState.activeNarrativeItem!.itemId,
      },
      event: 'content.delta',
    });

    return {
      itemEvents,
      messageId: liveState.activeNarrativeItem!.itemId,
    };
  }

  if (liveState.activeNarrativeItem?.kind !== 'assistant_message') {
    itemEvents.push(...closeActiveNarrativeItem(liveState, 'complete'));
    const assistantSegmentId = String(liveState.assistantSegmentCount);
    const itemId = buildPiAssistantSegmentItemId({
      assistantSegmentId,
      runId: event.runId,
      sessionId: event.sessionId,
    });
    liveState.assistantSegmentCount += 1;
    liveState.activeNarrativeItem = {
      assistantSegmentId,
      createdAt: event.timestamp,
      itemId,
      kind: 'assistant_message',
      runId: event.runId,
    };
    itemEvents.push({
      data: {
        assistantSegmentId,
        createdAt: event.timestamp,
        itemId,
        kind: 'assistant_message',
        runId: event.runId,
        status: 'streaming',
      },
      event: 'item.started',
    });
  }

  itemEvents.push({
    data: {
      contentKind: 'assistant_text',
      delta: event.delta,
      itemId: liveState.activeNarrativeItem!.itemId,
    },
    event: 'content.delta',
  });

  return {
    itemEvents,
    messageId: liveState.activeNarrativeItem!.itemId,
  };
};

const buildLiveToolStartEvents = (
  event: Extract<PiStreamEvent, { type: 'tool_execution_start' }>,
  liveState: PiLiveRunProjectionState,
) => {
  const itemEvents = closeActiveNarrativeItem(liveState, 'complete');
  const itemId = buildPiWorkUnitId({
    kind: 'tool_call',
    runId: event.runId,
    toolCallId: event.toolCallId,
  });
  liveState.toolItems.set(event.toolCallId, {
    createdAt: event.timestamp,
    input: event.args,
    itemId,
    runId: event.runId,
    sessionId: event.sessionId,
    startedAt: event.timestamp,
    toolCallId: event.toolCallId,
    toolName: event.toolName,
  });
  itemEvents.push({
    data: {
      createdAt: event.timestamp,
      input: toObjectRecord(event.args),
      itemId,
      kind: 'tool_call',
      runId: event.runId,
      sourceMessageId: event.toolCallId,
      startedAt: event.timestamp,
      status: 'running',
      toolLabel: event.toolName,
      toolName: event.toolName,
    },
    event: 'item.started',
  });

  return itemEvents;
};

const buildLiveToolUpdateEvent = (
  event: Extract<PiStreamEvent, { type: 'tool_execution_update' | 'tool_execution_end' }>,
  liveState: PiLiveRunProjectionState,
  completionStatus?: Extract<PiToolCallLifecycleItem['status'], 'cancelled' | 'complete' | 'error'>,
): PiToolCallLifecycleItem => {
  const toolState = liveState.toolItems.get(event.toolCallId);
  const itemId = toolState?.itemId ?? buildPiWorkUnitId({
    kind: 'tool_call',
    runId: event.runId,
    toolCallId: event.toolCallId,
  });
  const summary = event.type === 'tool_execution_update'
    ? summarizeUnknown(event.partialResult)
    : event.errorMessage ?? summarizeUnknown(event.result) ?? null;
  const output = summary
    ? {
      content: summary,
      summary,
    }
    : undefined;
  const status: PiToolCallLifecycleItem['status'] = completionStatus ?? 'running';
  const lifecycleItem = {
    createdAt: toolState?.createdAt ?? event.timestamp,
    durationMs: deriveDurationMs(toolState?.startedAt ?? event.timestamp, event.type === 'tool_execution_end' ? event.timestamp : null),
    errorMessage: event.type === 'tool_execution_end' ? event.errorMessage ?? null : null,
    finishedAt: event.type === 'tool_execution_end' ? event.timestamp : null,
    input: toObjectRecord(toolState?.input ?? event.args),
    itemId,
    kind: 'tool_call' as const,
    output,
    runId: event.runId,
    sourceMessageId: event.toolCallId,
    startedAt: toolState?.startedAt ?? event.timestamp,
    status,
    toolLabel: toolState?.toolName ?? event.toolName,
    toolName: toolState?.toolName ?? event.toolName,
  };

  if (event.type === 'tool_execution_end') {
    liveState.toolItems.delete(event.toolCallId);
  }

  return lifecycleItem;
};

const mapTranscript = (transcript: PiWrapperSessionTranscript): SharedPiSessionTranscript => ({
  cwd: transcript.cwd,
  messages: transcript.messages.map((message) => ({
    content: message.content,
    id: message.id,
    isError: message.isError,
    phase: message.phase,
    role: message.role,
    toolCallId: message.toolCallId,
    toolName: message.toolName,
  })),
  model: transcript.model,
  path: transcript.path,
  sessionId: transcript.sessionId,
  thinkingLevel: transcript.thinkingLevel,
});

const mapToolInvocation = (invocation: PiToolInvocation): PiToolStep => ({
  args: invocation.args,
  error: mapToolError(getPreferredPiToolInvocationError(invocation)),
  finishedAt: invocation.finishedAt,
  partialResult: invocation.partialResult,
  result: invocation.result,
  runId: invocation.runId,
  sessionId: invocation.sessionId,
  startedAt: invocation.startedAt,
  status: invocation.status,
  summary: getPreferredPiToolInvocationError(invocation)?.message ?? invocation.summary ?? summarizeUnknown(invocation.result),
  toolCallId: invocation.toolCallId,
  toolName: invocation.toolName,
});

const mapSessionSummary = (
  session: InternalPiSessionSummary,
  runStatus: PiRunStatus,
  lastToolName: string | null,
): PiSessionSummary => {
  const titleSource: ConversationTitleSource = session.titleSource ?? (session.name ? 'upstream' : 'placeholder');
  const titleStatus: ConversationTitleStatus = session.titleStatus ?? 'ready';

  return {
    cwd: session.cwd,
    degraded: runStatus.degraded,
    degradedReason: runStatus.degradedReason,
    id: session.id,
    lastError: runStatus.lastError,
    lastToolName,
    preview: session.firstMessage,
    runState: runStatus.state,
    title: session.title ?? session.name,
    titleSource,
    titleStatus,
    titleUpdatedAt: session.titleUpdatedAt ?? session.modifiedAt,
    updatedAt: session.modifiedAt,
  };
};

const buildToolStepFromStream = (event: Extract<
  PiStreamEvent,
  { type: 'tool_execution_start' | 'tool_execution_update' | 'tool_execution_end' }
>): PiToolStep => ({
  args: event.args,
  error: event.type === 'tool_execution_end' && event.isError
    ? {
      code: event.errorCode ?? 'PI_TOOL_ERROR',
      message: event.errorMessage
        ?? getPreferredPiToolInvocationError({
          args: event.args,
          error: null,
          result: event.result,
          toolName: event.toolName,
        })?.message
        ?? summarizeUnknown(event.result)
        ?? `Tool execution failed: ${event.toolName}`,
    }
    : null,
  finishedAt: event.type === 'tool_execution_end' ? event.timestamp : null,
  partialResult: event.type === 'tool_execution_update' ? event.partialResult : undefined,
  result: event.type === 'tool_execution_end' ? event.result : undefined,
  runId: event.runId,
  sessionId: event.sessionId,
  startedAt: event.timestamp,
  status: event.type === 'tool_execution_end'
    ? (event.isError ? 'error' : 'success')
    : 'running',
  summary: event.type === 'tool_execution_update'
    ? summarizeUnknown(event.partialResult)
    : event.type === 'tool_execution_end'
      ? event.errorMessage ?? summarizeUnknown(event.result)
      : null,
  toolCallId: event.toolCallId,
  toolName: event.toolName,
});

export const createPiSessionAdapter = (access: PiSessionAccess) => ({
  liveRuns: new Map<string, PiLiveRunProjectionState>(),
  async getSession(sessionId: string): Promise<PiSessionRecord | null> {
    const sessions = await access.listSessions();
    const session = sessions.find((item) => item.id === sessionId);

    if (!session) {
      return null;
    }

    const [transcript, toolInvocations] = await Promise.all([
      access.getSessionTranscript(sessionId),
      access.listToolInvocations(sessionId),
    ]);
    const liveStatus = access.getSessionRunStatus(sessionId);
    const runStatus = resolveRunStatus(sessionId, session.modifiedAt, liveStatus, transcript, toolInvocations);
    const projection = buildPiProjection({
      riskGateState: access.getRiskGateState(),
      runStatus,
      sessionId,
      toolInvocations,
      transcript,
    });

    return {
      ...mapSessionSummary(session, runStatus, resolveLastToolName(runStatus, toolInvocations)),
      projection,
      runStatus,
      toolSteps: toolInvocations.map(mapToolInvocation),
      transcript: mapTranscript(transcript),
    };
  },
  async getSessionTranscript(sessionId: string): Promise<SharedPiSessionTranscript> {
    return mapTranscript(await access.getSessionTranscript(sessionId));
  },
  async listSessions(): Promise<PiSessionSummary[]> {
    const sessions = await access.listSessions();
    return await Promise.all(sessions.map(async (session) => {
      const liveStatus = access.getSessionRunStatus(session.id);

      if (liveStatus) {
        const runStatus = resolveRunStatus(session.id, session.modifiedAt, liveStatus);
        return mapSessionSummary(session, runStatus, resolveLastToolName(runStatus, []));
      }

      const [transcript, toolInvocations] = await Promise.all([
        access.getSessionTranscript(session.id),
        access.listToolInvocations(session.id),
      ]);
      const runStatus = resolveRunStatus(session.id, session.modifiedAt, null, transcript, toolInvocations);
      return mapSessionSummary(session, runStatus, resolveLastToolName(runStatus, toolInvocations));
    }));
  },
  async mapStreamEvent(event: PiStreamEvent): Promise<PiAgentStreamEvent> {
    const getLiveRun = (runId: string) => {
      const existing = this.liveRuns.get(runId);

      if (existing) {
        return existing;
      }

      const next = createLiveRunProjectionState();
      this.liveRuns.set(runId, next);
      return next;
    };

    switch (event.type) {
      case 'session_created':
        {
          const runStatus = resolveRunStatus(event.session.id, event.timestamp, access.getSessionRunStatus(event.session.id));
          return {
            session: mapSessionSummary(event.session, runStatus, resolveLastToolName(runStatus, [])),
            timestamp: event.timestamp,
            type: 'session_created',
          };
        }
      case 'run_started':
        this.liveRuns.set(event.runId, createLiveRunProjectionState());
        return {
          message: event.message,
          itemEvents: [],
          status: resolveRunStatus(event.sessionId, event.timestamp, access.getSessionRunStatus(event.sessionId)),
          timestamp: event.timestamp,
          type: 'run_started',
        };
      case 'session_updated':
        {
          const runStatus = resolveRunStatus(event.session.id, event.timestamp, access.getSessionRunStatus(event.session.id));
          return {
            session: mapSessionSummary(event.session, runStatus, resolveLastToolName(runStatus, [])),
            timestamp: event.timestamp,
            type: 'session_updated',
          };
        }
      case 'message_delta':
        {
          const { itemEvents, messageId } = buildLiveMessageDeltaEvents(event, getLiveRun(event.runId));
          return {
            delta: event.delta,
            itemEvents,
            messageId,
            phase: event.phase,
            runId: event.runId,
            sessionId: event.sessionId,
            timestamp: event.timestamp,
            type: 'message_delta',
          };
        }
      case 'tool_execution_start':
        return {
          itemEvents: buildLiveToolStartEvents(event, getLiveRun(event.runId)),
          step: buildToolStepFromStream(event),
          timestamp: event.timestamp,
          type: 'tool_execution_start',
        };
      case 'tool_execution_update':
        return {
          itemEvents: [{
            data: buildLiveToolUpdateEvent(event, getLiveRun(event.runId)),
            event: 'item.updated',
          }],
          step: buildToolStepFromStream(event),
          timestamp: event.timestamp,
          type: 'tool_execution_update',
        };
      case 'tool_execution_end':
        {
          const liveRun = getLiveRun(event.runId);
          const completedStatus = event.isError ? 'error' : 'complete';
          const completionItem = buildLiveToolUpdateEvent(event, liveRun, completedStatus);
          return {
            itemEvents: [
              {
                data: completionItem,
                event: 'item.updated',
              },
              {
                data: completionItem,
                event: 'item.completed',
              },
            ],
            step: buildToolStepFromStream(event),
            timestamp: event.timestamp,
            type: 'tool_execution_end',
          };
        }
      case 'run_completed':
        {
          const liveRun = getLiveRun(event.runId);
          const itemEvents = closeActiveNarrativeItem(liveRun, 'complete');
          this.liveRuns.delete(event.runId);
          return {
            itemEvents,
            session: event.session
              ? mapSessionSummary(
                event.session,
                resolveRunStatus(event.sessionId, event.timestamp, access.getSessionRunStatus(event.sessionId), event.transcript),
                resolveLastToolName(resolveRunStatus(event.sessionId, event.timestamp, access.getSessionRunStatus(event.sessionId), event.transcript), []),
              )
              : undefined,
            status: resolveRunStatus(event.sessionId, event.timestamp, access.getSessionRunStatus(event.sessionId), event.transcript),
            timestamp: event.timestamp,
            transcript: mapTranscript(event.transcript),
            type: 'run_completed',
          };
        }
      case 'run_failed':
        {
          const liveRun = getLiveRun(event.runId);
          const itemEvents = closeActiveNarrativeItem(liveRun, 'error');
          this.liveRuns.delete(event.runId);
          return {
            error: event.error,
            itemEvents,
            session: event.session
              ? mapSessionSummary(
                event.session,
                resolveRunStatus(event.sessionId, event.timestamp, access.getSessionRunStatus(event.sessionId), undefined, []),
                resolveLastToolName(resolveRunStatus(event.sessionId, event.timestamp, access.getSessionRunStatus(event.sessionId), undefined, []), []),
              )
              : undefined,
            status: resolveRunStatus(event.sessionId, event.timestamp, access.getSessionRunStatus(event.sessionId), undefined, []),
            timestamp: event.timestamp,
            type: 'run_failed',
          };
        }
      case 'run_cancelled':
        {
          const liveRun = getLiveRun(event.runId);
          const itemEvents = closeActiveNarrativeItem(liveRun, 'cancelled');
          this.liveRuns.delete(event.runId);
          return {
            itemEvents,
            session: event.session
              ? mapSessionSummary(
                event.session,
                resolveRunStatus(event.sessionId, event.timestamp, access.getSessionRunStatus(event.sessionId), undefined, []),
                resolveLastToolName(resolveRunStatus(event.sessionId, event.timestamp, access.getSessionRunStatus(event.sessionId), undefined, []), []),
              )
              : undefined,
            status: resolveRunStatus(event.sessionId, event.timestamp, access.getSessionRunStatus(event.sessionId), undefined, []),
            timestamp: event.timestamp,
            type: 'run_cancelled',
          };
        }
      case 'diagnostics_updated':
        return {
          status: event.status,
          timestamp: event.timestamp,
          type: 'diagnostics_updated',
        };
      default:
        return event satisfies never;
    }
  },
});
