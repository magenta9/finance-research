import type { PiRunState } from '@quantdesk/shared';

import type { PiStreamEvent } from './types';

export interface PiManagerSessionRunStatus {
  currentTool: string | null;
  degraded: boolean;
  degradedReason: string | null;
  lastError: string | null;
  runId: string | null;
  sessionId: string;
  state: PiRunState;
  updatedAt: string;
}

const createSessionRunStatus = (
  sessionId: string,
  state: PiRunState,
  updatedAt: string,
  runId: string | null = null,
): PiManagerSessionRunStatus => ({
  currentTool: null,
  degraded: false,
  degradedReason: null,
  lastError: null,
  runId,
  sessionId,
  state,
  updatedAt,
});

export class PiRunStatusStore {
  private readonly sessionRuns = new Map<string, PiManagerSessionRunStatus>();

  delete(sessionId: string) {
    this.sessionRuns.delete(sessionId);
  }

  get(sessionId: string): PiManagerSessionRunStatus | null {
    const status = this.sessionRuns.get(sessionId);
    return status ? { ...status } : null;
  }

  apply(event: PiStreamEvent) {
    switch (event.type) {
      case 'session_created': {
        const current = this.sessionRuns.get(event.session.id);
        if (!current) {
          this.sessionRuns.set(
            event.session.id,
            createSessionRunStatus(event.session.id, 'idle', event.timestamp),
          );
        }
        return;
      }
      case 'session_updated':
        return;
      case 'run_started': {
        this.sessionRuns.set(event.sessionId, {
          ...createSessionRunStatus(event.sessionId, 'running', event.timestamp, event.runId),
        });
        return;
      }
      case 'message_delta': {
        const current = this.sessionRuns.get(event.sessionId);
        if (!current) {
          this.sessionRuns.set(
            event.sessionId,
            createSessionRunStatus(event.sessionId, 'running', event.timestamp, event.runId),
          );
          return;
        }

        this.sessionRuns.set(event.sessionId, {
          ...current,
          runId: event.runId,
          state: current.state === 'failed' || current.state === 'cancelled' ? 'running' : current.state,
          updatedAt: event.timestamp,
        });
        return;
      }
      case 'tool_execution_start': {
        const current = this.sessionRuns.get(event.sessionId)
          ?? createSessionRunStatus(event.sessionId, 'running', event.timestamp, event.runId);
        this.sessionRuns.set(event.sessionId, {
          ...current,
          currentTool: event.toolName,
          runId: event.runId,
          state: 'running',
          updatedAt: event.timestamp,
        });
        return;
      }
      case 'tool_execution_update': {
        const current = this.sessionRuns.get(event.sessionId)
          ?? createSessionRunStatus(event.sessionId, 'running', event.timestamp, event.runId);
        this.sessionRuns.set(event.sessionId, {
          ...current,
          currentTool: event.toolName,
          runId: event.runId,
          state: 'running',
          updatedAt: event.timestamp,
        });
        return;
      }
      case 'tool_execution_end': {
        const current = this.sessionRuns.get(event.sessionId)
          ?? createSessionRunStatus(event.sessionId, 'running', event.timestamp, event.runId);
        this.sessionRuns.set(event.sessionId, {
          ...current,
          currentTool: null,
          lastError: event.isError
            ? event.errorMessage ?? `Tool execution failed: ${event.toolName}`
            : current.lastError,
          runId: event.runId,
          state: event.isError ? 'failed' : 'running',
          updatedAt: event.timestamp,
        });
        return;
      }
      case 'run_completed': {
        const current = this.sessionRuns.get(event.sessionId)
          ?? createSessionRunStatus(event.sessionId, 'idle', event.timestamp, event.runId);
        this.sessionRuns.set(event.sessionId, {
          ...current,
          currentTool: null,
          lastError: null,
          runId: event.runId,
          state: 'idle',
          updatedAt: event.timestamp,
        });
        return;
      }
      case 'run_failed': {
        const current = this.sessionRuns.get(event.sessionId)
          ?? createSessionRunStatus(event.sessionId, 'failed', event.timestamp, event.runId);
        this.sessionRuns.set(event.sessionId, {
          ...current,
          currentTool: null,
          lastError: event.error,
          runId: event.runId,
          state: 'failed',
          updatedAt: event.timestamp,
        });
        return;
      }
      case 'run_cancelled': {
        const current = this.sessionRuns.get(event.sessionId)
          ?? createSessionRunStatus(event.sessionId, 'cancelled', event.timestamp, event.runId);
        this.sessionRuns.set(event.sessionId, {
          ...current,
          currentTool: null,
          runId: event.runId,
          state: 'cancelled',
          updatedAt: event.timestamp,
        });
        return;
      }
      case 'diagnostics_updated':
        return;
      default:
        return;
    }
  }
}
