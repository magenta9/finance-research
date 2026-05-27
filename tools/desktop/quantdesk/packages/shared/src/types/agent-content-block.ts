export type AssistantMessageStatus = 'streaming' | 'complete' | 'error' | 'cancelled';

export type ToolCallBlockStatus =
  | 'pending'
  | 'running'
  | 'requires_approval'
  | 'approved'
  | 'rejected'
  | 'complete'
  | 'error'
  | 'cancelled';

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
}

export interface LegacyRichBlock {
  type: 'text' | 'table' | 'metric-grid' | 'chart' | 'citations';
  title: string;
  data: Record<string, unknown>;
}

export interface DiffStructuredOutput {
  type: 'diff';
  files: Array<{
    path: string;
    additions?: number;
    deletions?: number;
    patch?: string;
  }>;
}

export interface TerminalStructuredOutput {
  type: 'terminal';
  lines: Array<{
    kind?: 'stdout' | 'stderr' | 'command';
    text: string;
  }>;
}

export interface SearchResultsStructuredOutput {
  type: 'search_results';
  results: Array<{
    path: string;
    title?: string;
    snippet?: string;
  }>;
}

export interface ImageStructuredOutput {
  type: 'image';
  url: string;
  alt?: string;
}

export type StructuredOutput =
  | DiffStructuredOutput
  | TerminalStructuredOutput
  | SearchResultsStructuredOutput
  | ImageStructuredOutput;

export interface ThinkingBlock {
  type: 'thinking';
  id: string;
  content: string;
  summary?: string;
  durationMs?: number | null;
  status: 'streaming' | 'complete';
}

export interface ToolCallOutput {
  summary: string;
  content?: string;
  structured?: StructuredOutput;
}

export interface ToolCallBlock {
  type: 'tool_call';
  id: string;
  toolName: string;
  toolLabel: string;
  input: Record<string, unknown>;
  output?: ToolCallOutput;
  status: ToolCallBlockStatus;
  durationMs?: number | null;
  errorMessage?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface TextBlock {
  type: 'text';
  id: string;
  content: string;
  status: 'streaming' | 'complete';
  richBlocks?: LegacyRichBlock[];
}

export interface CodeBlock {
  type: 'code';
  id: string;
  language?: string;
  content: string;
  filename?: string;
}

export interface ErrorBlock {
  type: 'error';
  id: string;
  message: string;
  code?: string;
}

export type ContentBlock = ThinkingBlock | ToolCallBlock | TextBlock | CodeBlock | ErrorBlock;

export interface AssistantMessage {
  id: string;
  role: 'assistant';
  createdAt: string | null;
  assistantSegmentId?: string | null;
  runId?: string | null;
  sourceMessageId?: string | null;
  status: AssistantMessageStatus;
  blocks: ContentBlock[];
  usage?: TokenUsage;
  model?: string | null;
  providerId?: string | null;
  durationMs?: number | null;
  replayUnavailable?: boolean;
}

export interface TimelineMessageItem {
  kind: 'message';
  id: string;
  role: string;
  content: string;
  createdAt: string | null;
  sourceMessageId?: string | null;
}

export interface TimelineAssistantMessageItem {
  kind: 'assistant_message';
  id: string;
  createdAt: string | null;
  sourceMessageId?: string | null;
  assistantMessage: AssistantMessage;
}

export interface PiReasoningUnit {
  kind: 'reasoning';
  id: string;
  content: string;
  createdAt: string | null;
  durationMs?: number | null;
  runId?: string | null;
  sourceMessageId?: string | null;
  status: 'streaming' | 'complete' | 'cancelled';
  summary?: string;
}

export interface PiToolCallUnit {
  kind: 'tool_call';
  id: string;
  createdAt: string | null;
  durationMs?: number | null;
  errorMessage?: string | null;
  finishedAt?: string | null;
  input: Record<string, unknown>;
  output?: ToolCallOutput;
  runId?: string | null;
  sourceMessageId?: string | null;
  startedAt?: string | null;
  status: ToolCallBlockStatus;
  toolLabel: string;
  toolName: string;
}

export type PiWorkUnit = PiReasoningUnit | PiToolCallUnit;

export interface TimelineWorkUnitItem {
  kind: 'work_unit';
  id: string;
  createdAt: string | null;
  sourceMessageId?: string | null;
  workUnit: PiWorkUnit;
}

export type ConversationTimelineItem =
  | TimelineMessageItem
  | TimelineWorkUnitItem
  | TimelineAssistantMessageItem;

export interface AssistantContentProjection {
  approvalBlock: ToolCallBlock | null;
  assistantMessages: AssistantMessage[];
  workUnits: PiWorkUnit[];
  timeline: ConversationTimelineItem[];
}

export type PiItemKind = 'assistant_message' | PiWorkUnit['kind'];

interface PiItemLifecycleBase {
  createdAt: string | null;
  itemId: string;
  runId?: string | null;
  sourceMessageId?: string | null;
}

export interface PiReasoningLifecycleItem extends PiItemLifecycleBase {
  durationMs?: number | null;
  kind: 'reasoning';
  status: PiReasoningUnit['status'];
  summary?: string;
}

export interface PiToolCallLifecycleItem extends PiItemLifecycleBase {
  durationMs?: number | null;
  errorMessage?: string | null;
  finishedAt?: string | null;
  input: Record<string, unknown>;
  kind: 'tool_call';
  output?: ToolCallOutput;
  startedAt?: string | null;
  status: ToolCallBlockStatus;
  toolLabel: string;
  toolName: string;
}

export interface PiAssistantMessageLifecycleItem extends PiItemLifecycleBase {
  assistantSegmentId?: string | null;
  kind: 'assistant_message';
  model?: string | null;
  providerId?: string | null;
  status: AssistantMessageStatus;
  usage?: TokenUsage;
}

export type PiItemLifecycleItem =
  | PiReasoningLifecycleItem
  | PiToolCallLifecycleItem
  | PiAssistantMessageLifecycleItem;

export type PiItemEvent =
  | {
    event: 'item.started';
    data: PiItemLifecycleItem;
  }
  | {
    event: 'item.updated';
    data: PiItemLifecycleItem;
  }
  | {
    event: 'content.delta';
    data: {
      contentKind: 'assistant_text' | 'reasoning';
      delta: string;
      itemId: string;
    };
  }
  | {
    event: 'item.completed';
    data: PiItemLifecycleItem;
  };

export type NormalizedBlockDelta =
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; text: string }
  | { type: 'tool_call_delta'; outputDelta?: string }
  | { type: 'tool_status_change'; status: ToolCallBlockStatus };

export type NormalizedStreamEvent =
  | {
    event: 'message_start';
    data: {
      messageId: string;
      model?: string | null;
      providerId?: string | null;
    };
  }
  | {
    event: 'block_start';
    data: {
      messageId: string;
      block: ContentBlock;
    };
  }
  | {
    event: 'block_delta';
    data: {
      messageId: string;
      blockId: string;
      delta: NormalizedBlockDelta;
    };
  }
  | {
    event: 'block_end';
    data: {
      messageId: string;
      blockId: string;
      status: string;
    };
  }
  | {
    event: 'message_end';
    data: {
      messageId: string;
      usage?: TokenUsage;
      status: AssistantMessageStatus;
    };
  }
  | {
    event: 'error';
    data: {
      messageId: string;
      message: string;
      code?: string;
    };
  };

const normalizeStablePart = (value: string | null | undefined, fallback: string) => {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
};

export const buildAssistantMessageId = (input: {
  messageId?: string | null;
  runId?: string | null;
  sessionId?: string | null;
}) => {
  if (input.messageId && input.messageId.trim().length > 0) {
    return input.messageId;
  }

  if (input.runId && input.runId.trim().length > 0) {
    return `assistant:${input.runId}`;
  }

  return `assistant:${normalizeStablePart(input.sessionId, 'pending')}`;
};

export const buildPiAssistantSegmentItemId = (input: {
  assistantSegmentId?: string | null;
  messageId?: string | null;
  runId?: string | null;
  sessionId?: string | null;
}) => {
  if (input.messageId && input.messageId.trim().length > 0) {
    return `assistant:${input.messageId}`;
  }

  if (input.runId && input.runId.trim().length > 0) {
    return `assistant:${input.runId}:segment:${normalizeStablePart(input.assistantSegmentId, '0')}`;
  }

  return `assistant:${normalizeStablePart(input.sessionId, 'pending')}:segment:${normalizeStablePart(input.assistantSegmentId, '0')}`;
};

export const buildPiWorkUnitId = (input: {
  kind: PiWorkUnit['kind'];
  index?: number;
  runId?: string | null;
  sourceMessageId?: string | null;
  toolCallId?: string | null;
}) => {
  if (input.kind === 'tool_call') {
    return `tool:${normalizeStablePart(input.toolCallId, normalizeStablePart(input.runId, `slot-${input.index ?? 0}`))}`;
  }

  if (input.sourceMessageId && input.sourceMessageId.trim().length > 0) {
    return `reasoning:${input.sourceMessageId}`;
  }

  return `reasoning:${normalizeStablePart(input.runId, 'pending')}:${input.index ?? 0}`;
};

export const buildContentBlockId = (input: {
  kind: ContentBlock['type'];
  messageId?: string | null;
  runId?: string | null;
  toolCallId?: string | null;
  executionId?: string | null;
  phase?: string | null;
  index?: number;
}) => {
  const ownerId = buildAssistantMessageId({
    messageId: input.messageId,
    runId: input.runId,
  });
  const toolSegment = normalizeStablePart(input.toolCallId ?? input.executionId, `slot-${input.index ?? 0}`);
  const phaseSegment = normalizeStablePart(input.phase, input.kind);

  if (input.kind === 'tool_call') {
    return `${ownerId}:tool:${toolSegment}`;
  }

  return `${ownerId}:${input.kind}:${phaseSegment}:${input.index ?? 0}`;
};