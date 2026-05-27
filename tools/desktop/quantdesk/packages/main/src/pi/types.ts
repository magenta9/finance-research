import type {
  ConversationTitleSource,
  ConversationTitleStatus,
  PiRuntimeDirectories,
  PiRuntimeStatus,
  PiSkillSummary,
  PiStagedAttachment,
} from '@quantdesk/shared';

import type { FinanceToolPayload } from '../agent/capabilities/finance';

export type {
  PiDiagnosticItem,
  PiFinanceToolStatus,
  PiModelSummary,
  PiRuntimeDirectories,
  PiRuntimeState,
  PiRuntimeStatus,
} from '@quantdesk/shared';

export interface PiWrapperHealth {
  currentSessionId: string | null;
  directories: PiRuntimeDirectories;
  ok: true;
  pid: number;
  wrapperVersion: string | null;
}

export interface PiWrapperSessionSummary {
  cwd: string;
  firstMessage: string;
  id: string;
  modifiedAt: string;
  name: string | null;
  path: string;
  title?: string | null;
  titleSource?: ConversationTitleSource;
  titleStatus?: ConversationTitleStatus;
  titleUpdatedAt?: string | null;
}

export interface PiWrapperTranscriptMessage {
  content: string;
  id: string;
  isError?: boolean;
  raw?: unknown;
  phase?: 'assistant' | 'thinking';
  role: string;
  toolCallId?: string;
  toolName?: string;
}

export interface PiWrapperSessionTranscript {
  cwd: string;
  messages: PiWrapperTranscriptMessage[];
  model: {
    modelId: string;
    provider: string;
  } | null;
  path: string;
  sessionId: string;
  thinkingLevel: string;
}

export interface PiToolInvocationError {
  code?: string;
  message: string;
}

export interface PiToolInvocation {
  args: Record<string, unknown>;
  error: PiToolInvocationError | null;
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

export type PiWrapperSkillSummary = PiSkillSummary;

export interface PiResolvedAttachment extends PiStagedAttachment {
  path: string;
}

export interface PiSendMessageInput {
  allowedToolNames?: string[];
  attachments?: PiResolvedAttachment[];
  message: string;
  sessionId?: string;
  startNewSession?: boolean;
}

export interface PiSendMessageResult {
  runId: string;
  sessionId: string;
}

export interface PiGenerateTitleInput {
  cwd?: string;
  message: string;
}

export interface PiGenerateTitleResult {
  title: string | null;
}

export interface PiCancelRunInput {
  runId: string;
  sessionId: string;
}

export interface PiCancelRunResult {
  cancelled: boolean;
}

export interface PiToolHostExecuteRequest {
  args: Record<string, unknown>;
  runId: string;
  sessionId: string;
  toolCallId: string;
  toolName: string;
}

export interface PiToolHostExecuteResponse {
  payload: FinanceToolPayload;
}

export type PiStreamEvent =
  | {
    session: PiWrapperSessionSummary;
    timestamp: string;
    type: 'session_created';
  }
  | {
    session: PiWrapperSessionSummary;
    timestamp: string;
    type: 'session_updated';
  }
  | {
    message: string;
    runId: string;
    sessionId: string;
    timestamp: string;
    type: 'run_started';
  }
  | {
    delta: string;
    messageId: string;
    phase: 'assistant' | 'thinking';
    runId: string;
    sessionId: string;
    timestamp: string;
    type: 'message_delta';
  }
  | {
    args: Record<string, unknown>;
    runId: string;
    sessionId: string;
    timestamp: string;
    toolCallId: string;
    toolName: string;
    type: 'tool_execution_start';
  }
  | {
    args: Record<string, unknown>;
    partialResult: unknown;
    runId: string;
    sessionId: string;
    timestamp: string;
    toolCallId: string;
    toolName: string;
    type: 'tool_execution_update';
  }
  | {
    args: Record<string, unknown>;
    errorCode?: string;
    errorMessage?: string;
    isError?: boolean;
    result: unknown;
    runId: string;
    sessionId: string;
    timestamp: string;
    toolCallId: string;
    toolName: string;
    type: 'tool_execution_end';
  }
  | {
    session?: PiWrapperSessionSummary;
    runId: string;
    sessionId: string;
    timestamp: string;
    transcript: PiWrapperSessionTranscript;
    type: 'run_completed';
  }
  | {
    error: string;
    session?: PiWrapperSessionSummary;
    runId: string;
    sessionId: string;
    timestamp: string;
    type: 'run_failed';
  }
  | {
    session?: PiWrapperSessionSummary;
    runId: string;
    sessionId: string;
    timestamp: string;
    type: 'run_cancelled';
  }
  | {
    status: PiRuntimeStatus;
    timestamp: string;
    type: 'diagnostics_updated';
  };
