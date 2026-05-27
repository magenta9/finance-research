import type {
  AssistantContentProjection,
  PiItemEvent,
} from './agent-content-block';
import type {
  ConversationTitleMetadata,
  ToolExecutionError,
} from './agent';
import type { PiRuntimeStatus } from './pi-runtime';

export type PiRunState = 'idle' | 'running' | 'cancelled' | 'failed';

export interface PiSessionSummary extends ConversationTitleMetadata {
  cwd: string;
  degraded: boolean;
  degradedReason: string | null;
  id: string;
  lastError: string | null;
  lastToolName: string | null;
  preview: string;
  runState: PiRunState;
  title: string | null;
  updatedAt: string;
}

export interface PiTranscriptMessage {
  content: string;
  id: string;
  isError?: boolean;
  phase?: 'assistant' | 'thinking';
  role: string;
  toolCallId?: string;
  toolName?: string;
}

export interface PiSessionTranscript {
  cwd: string;
  messages: PiTranscriptMessage[];
  model: {
    modelId: string;
    provider: string;
  } | null;
  path: string;
  sessionId: string;
  thinkingLevel: string;
}

export interface PiToolStep {
  args: Record<string, unknown>;
  error: ToolExecutionError | null;
  finishedAt: string | null;
  partialResult?: unknown;
  result?: unknown;
  runId: string | null;
  sessionId: string;
  startedAt: string;
  status: 'running' | 'success' | 'error' | 'cancelled';
  summary?: string | null;
  toolCallId: string;
  toolName: string;
}

export interface PiRunStatus {
  currentTool: string | null;
  degraded: boolean;
  degradedReason: string | null;
  lastError: string | null;
  runId: string | null;
  sessionId: string;
  state: PiRunState;
  updatedAt: string;
}

export interface PiSessionRecord extends PiSessionSummary {
  projection: AssistantContentProjection;
  runStatus: PiRunStatus | null;
  toolSteps: PiToolStep[];
  transcript: PiSessionTranscript;
}

export type PiAttachmentKind = 'image' | 'text_document';

export interface PiStagedAttachment {
  id: string;
  kind: PiAttachmentKind;
  mimeType: string;
  name: string;
  size: number;
}

export interface PiAttachmentRejection {
  name: string;
  reason: string;
}

export interface PiStageAttachmentsResponse {
  attachments: PiStagedAttachment[];
  rejected: PiAttachmentRejection[];
}

export interface PiDiscardAttachmentsRequest {
  attachmentIds: string[];
}

export interface PiSkillSummary {
  description: string | null;
  name: string;
  path: string;
  source: string;
}

interface PiAgentStreamEventBase {
  itemEvents?: PiItemEvent[];
  projection?: AssistantContentProjection;
}

export interface PiSendMessageRequest {
  message: string;
  sessionId?: string;
  attachments?: PiStagedAttachment[];
}

export interface PiSendMessageResponse {
  runId: string;
  sessionId: string;
}

export interface PiCancelRunRequest {
  runId: string;
  sessionId: string;
}

export interface PiCancelRunResponse {
  cancelled: boolean;
}

export type PiAgentStreamEvent =
  | (PiAgentStreamEventBase & {
    session: PiSessionSummary;
    timestamp: string;
    type: 'session_created';
  })
  | (PiAgentStreamEventBase & {
    session: PiSessionSummary;
    timestamp: string;
    type: 'session_updated';
  })
  | (PiAgentStreamEventBase & {
    message: string;
    status: PiRunStatus;
    timestamp: string;
    type: 'run_started';
  })
  | (PiAgentStreamEventBase & {
    delta: string;
    messageId: string;
    phase: 'assistant' | 'thinking';
    runId: string;
    sessionId: string;
    timestamp: string;
    type: 'message_delta';
  })
  | (PiAgentStreamEventBase & {
    step: PiToolStep;
    timestamp: string;
    type: 'tool_execution_start';
  })
  | (PiAgentStreamEventBase & {
    step: PiToolStep;
    timestamp: string;
    type: 'tool_execution_update';
  })
  | (PiAgentStreamEventBase & {
    step: PiToolStep;
    timestamp: string;
    type: 'tool_execution_end';
  })
  | (PiAgentStreamEventBase & {
    session?: PiSessionSummary;
    status: PiRunStatus;
    timestamp: string;
    transcript: PiSessionTranscript;
    type: 'run_completed';
  })
  | (PiAgentStreamEventBase & {
    error: string;
    session?: PiSessionSummary;
    status: PiRunStatus;
    timestamp: string;
    type: 'run_failed';
  })
  | (PiAgentStreamEventBase & {
    session?: PiSessionSummary;
    status: PiRunStatus;
    timestamp: string;
    type: 'run_cancelled';
  })
  | (PiAgentStreamEventBase & {
    status: PiRuntimeStatus;
    timestamp: string;
    type: 'diagnostics_updated';
  });
