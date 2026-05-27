import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { asString, isRecord } from '@quantdesk/shared/type-guards';

import { getPreferredPiToolInvocationError } from '../error-normalization';
import type { PiRuntimeDirectories, PiStreamEvent, PiToolInvocation } from '../types';

interface ToolInvocationContext {
  runId: string | null;
  sessionId: string;
}

export class PiWrapperToolInvocationStore {
  private readonly directories: PiRuntimeDirectories;

  private readonly emitEvent: (event: PiStreamEvent) => void;

  private readonly loadedInvocationMaps = new Map<string, Map<string, PiToolInvocation>>();

  private readonly onError?: (error: unknown) => void;

  constructor({
    directories,
    emitEvent,
    onError,
  }: {
    directories: PiRuntimeDirectories;
    emitEvent: (event: PiStreamEvent) => void;
    onError?: (error: unknown) => void;
  }) {
    this.directories = directories;
    this.emitEvent = emitEvent;
    this.onError = onError;
  }

  getLatestForRun(sessionId: string, runId: string): PiToolInvocation | null {
    return Array.from(this.getInvocationMap(sessionId).values())
      .filter((invocation) => invocation.runId === runId)
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
      .at(-1) ?? null;
  }

  list(sessionId: string): PiToolInvocation[] {
    return Array.from(this.getInvocationMap(sessionId).values())
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  }

  markRunCancelled(sessionId: string, runId: string, timestamp: string) {
    const invocationMap = this.getInvocationMap(sessionId);
    let changed = false;

    for (const invocation of invocationMap.values()) {
      if (invocation.runId !== runId || invocation.status !== 'running') {
        continue;
      }

      invocation.finishedAt = timestamp;
      invocation.status = 'cancelled';
      changed = true;
    }

    if (changed) {
      this.persist(sessionId);
    }
  }

  recordToolStart(event: Record<string, unknown>, context: ToolInvocationContext) {
    const toolCallId = asString(event.toolCallId) || crypto.randomUUID();
    const invocation: PiToolInvocation = {
      args: isRecord(event.args) ? event.args : {},
      error: null,
      finishedAt: null,
      runId: context.runId,
      sessionId: context.sessionId,
      startedAt: new Date().toISOString(),
      status: 'running',
      toolCallId,
      toolName: asString(event.toolName) || 'unknown-tool',
    };

    this.getInvocationMap(context.sessionId).set(toolCallId, invocation);
    this.persist(context.sessionId);
    this.emitEvent({
      args: invocation.args,
      runId: invocation.runId ?? '',
      sessionId: context.sessionId,
      timestamp: invocation.startedAt,
      toolCallId,
      toolName: invocation.toolName,
      type: 'tool_execution_start',
    });
  }

  recordToolUpdate(event: Record<string, unknown>, context: ToolInvocationContext) {
    const toolCallId = asString(event.toolCallId);
    const invocation = this.getInvocationMap(context.sessionId).get(toolCallId);

    if (!invocation) {
      return;
    }

    invocation.partialResult = event.partialResult;
    this.persist(context.sessionId);
    this.emitEvent({
      args: invocation.args,
      partialResult: event.partialResult,
      runId: invocation.runId ?? context.runId ?? '',
      sessionId: context.sessionId,
      timestamp: new Date().toISOString(),
      toolCallId,
      toolName: invocation.toolName,
      type: 'tool_execution_update',
    });
  }

  recordToolEnd(event: Record<string, unknown>, context: ToolInvocationContext) {
    const toolCallId = asString(event.toolCallId);
    const invocation = this.getInvocationMap(context.sessionId).get(toolCallId);

    if (!invocation) {
      return;
    }

    invocation.finishedAt = new Date().toISOString();
    invocation.result = event.result;
    invocation.status = event.isError ? 'error' : invocation.status === 'cancelled' ? 'cancelled' : 'success';
    const error = event.isError
      ? getPreferredPiToolInvocationError({
        args: invocation.args,
        error: invocation.error,
        result: event.result,
        toolName: invocation.toolName,
      })
      : null;
    invocation.error = error;
    invocation.summary = error?.message ?? invocation.summary;
    this.persist(context.sessionId);
    this.emitEvent({
      args: invocation.args,
      errorCode: error?.code,
      errorMessage: error?.message,
      isError: Boolean(event.isError),
      result: event.result,
      runId: invocation.runId ?? context.runId ?? '',
      sessionId: context.sessionId,
      timestamp: invocation.finishedAt,
      toolCallId,
      toolName: invocation.toolName,
      type: 'tool_execution_end',
    });
  }

  private getInvocationFile(sessionId: string) {
    return path.join(this.directories.toolInvocationDir, `${sessionId}.json`);
  }

  private getInvocationMap(sessionId: string) {
    const existing = this.loadedInvocationMaps.get(sessionId);

    if (existing) {
      return existing;
    }

    const invocationFile = this.getInvocationFile(sessionId);
    const loaded = new Map<string, PiToolInvocation>();

    if (fs.existsSync(invocationFile)) {
      try {
        const entries = JSON.parse(fs.readFileSync(invocationFile, 'utf8')) as PiToolInvocation[];

        for (const entry of entries) {
          loaded.set(entry.toolCallId, entry);
        }
      } catch (error) {
        this.onError?.(error);
      }
    }

    this.loadedInvocationMaps.set(sessionId, loaded);
    return loaded;
  }

  private persist(sessionId: string) {
    const invocationFile = this.getInvocationFile(sessionId);
    const entries = Array.from(this.getInvocationMap(sessionId).values())
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
    fs.writeFileSync(invocationFile, JSON.stringify(entries, null, 2), 'utf8');
  }
}
