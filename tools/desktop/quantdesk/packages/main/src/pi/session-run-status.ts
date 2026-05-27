import type { PiRunStatus } from '@quantdesk/shared';

import type { PiManagerSessionRunStatus } from './run-status-store';
import {
  choosePreferredPiFailureMessage,
  getPreferredPiToolInvocationError,
} from './error-normalization';
import { hasPiTranscriptTerminalAssistantResponse } from './wrapper/transcript';
import type { PiWrapperSessionTranscript, PiToolInvocation } from './types';

const findTranscriptFailure = (transcript: PiWrapperSessionTranscript): string | null => {
  const latestMessage = [...transcript.messages]
    .reverse()
    .find((message) => message.content.trim().length > 0 || message.isError);

  if (!latestMessage?.isError) {
    return null;
  }

  const content = latestMessage.content.trim();
  return content.length > 0 ? content : 'Pi 运行失败，但未返回错误详情。';
};

const getLatestInvocationTimestamp = (invocation: PiToolInvocation | null): string | null => {
  if (!invocation) {
    return null;
  }

  return invocation.finishedAt ?? invocation.startedAt;
};

const isLatestInvocationCurrent = (
  invocation: PiToolInvocation | null,
  updatedAt: string,
) => {
  const latestTimestamp = getLatestInvocationTimestamp(invocation);

  return Boolean(latestTimestamp && latestTimestamp >= updatedAt);
};

const getLatestToolInvocation = (toolInvocations: PiToolInvocation[]): PiToolInvocation | null => (
  toolInvocations.length > 0 ? toolInvocations[toolInvocations.length - 1] : null
);

export const summarizeUnknown = (value: unknown): string | null => {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }

  if (value && typeof value === 'object') {
    if ('summary' in value && typeof value.summary === 'string' && value.summary.trim().length > 0) {
      return value.summary.trim();
    }

    if ('message' in value && typeof value.message === 'string' && value.message.trim().length > 0) {
      return value.message.trim();
    }
  }

  return null;
};

const inferPersistedRunStatus = (
  sessionId: string,
  transcript: PiWrapperSessionTranscript,
  toolInvocations: PiToolInvocation[],
  updatedAt: string,
): PiRunStatus | null => {
  const latestToolInvocation = getLatestToolInvocation(toolInvocations);
  const latestInvocationIsCurrent = isLatestInvocationCurrent(latestToolInvocation, updatedAt);
  const hasTerminalAssistantResponse = hasPiTranscriptTerminalAssistantResponse(transcript);
  const latestInvocationForFailure = !hasTerminalAssistantResponse && latestInvocationIsCurrent
    ? latestToolInvocation
    : null;
  const transcriptFailure = choosePreferredPiFailureMessage(
    findTranscriptFailure(transcript),
    latestInvocationForFailure,
  );

  if (transcriptFailure) {
    return {
      currentTool: null,
      degraded: false,
      degradedReason: null,
      lastError: transcriptFailure,
      runId: latestInvocationIsCurrent ? latestToolInvocation?.runId ?? null : null,
      sessionId,
      state: 'failed',
      updatedAt,
    };
  }

  if (hasTerminalAssistantResponse) {
    return null;
  }

  if (latestInvocationIsCurrent && latestToolInvocation?.status === 'error') {
    const invocationError = getPreferredPiToolInvocationError(latestToolInvocation);

    return {
      currentTool: null,
      degraded: false,
      degradedReason: null,
      lastError: invocationError?.message
        ?? latestToolInvocation.summary
        ?? summarizeUnknown(latestToolInvocation.result)
        ?? `Tool execution failed: ${latestToolInvocation.toolName}`,
      runId: latestToolInvocation.runId,
      sessionId,
      state: 'failed',
      updatedAt,
    };
  }

  if (latestInvocationIsCurrent && latestToolInvocation?.status === 'cancelled') {
    return {
      currentTool: null,
      degraded: false,
      degradedReason: null,
      lastError: null,
      runId: latestToolInvocation.runId,
      sessionId,
      state: 'cancelled',
      updatedAt,
    };
  }

  return null;
};

const mapRunStatus = (
  sessionId: string,
  status: PiManagerSessionRunStatus | null,
  updatedAt: string,
): PiRunStatus => {
  if (!status) {
    return {
      currentTool: null,
      degraded: false,
      degradedReason: null,
      lastError: null,
      runId: null,
      sessionId,
      state: 'idle',
      updatedAt,
    };
  }

  return {
    currentTool: status.currentTool,
    degraded: status.degraded,
    degradedReason: status.degradedReason,
    lastError: status.lastError,
    runId: status.runId,
    sessionId: status.sessionId,
    state: status.state,
    updatedAt: status.updatedAt,
  };
};

export const resolveRunStatus = (
  sessionId: string,
  updatedAt: string,
  liveStatus: PiManagerSessionRunStatus | null,
  transcript?: PiWrapperSessionTranscript,
  toolInvocations: PiToolInvocation[] = [],
): PiRunStatus => {
  if (liveStatus) {
    return mapRunStatus(sessionId, liveStatus, updatedAt);
  }

  return inferPersistedRunStatus(sessionId, transcript ?? {
    cwd: '',
    messages: [],
    model: null,
    path: '',
    sessionId,
    thinkingLevel: 'off',
  }, toolInvocations, updatedAt) ?? mapRunStatus(sessionId, null, updatedAt);
};

export const resolveLastToolName = (
  runStatus: PiRunStatus,
  toolInvocations: PiToolInvocation[],
): string | null => runStatus.currentTool ?? getLatestToolInvocation(toolInvocations)?.toolName ?? null;
