import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import crypto from 'node:crypto';

import type { LoggerLike } from '../logger';
import { PiClient } from './client';
import { PiEventBus } from './event-bus';
import { PiRunStatusStore, type PiManagerSessionRunStatus } from './run-status-store';
import { PiSessionTitleStore, type PiSessionTitleMetadata } from './session-title-store';
import type {
  PiGenerateTitleResult,
  PiRuntimeDirectories,
  PiRuntimeStatus,
  PiSendMessageInput,
  PiSendMessageResult,
  PiWrapperSessionSummary,
  PiWrapperSessionTranscript,
  PiStreamEvent,
  PiToolHostExecuteRequest,
  PiToolInvocation,
  PiWrapperHealth,
  PiWrapperSkillSummary,
} from './types';
import type { PiToolHost } from './tool-host';

export type { PiManagerSessionRunStatus } from './run-status-store';

export interface PiManagerSpawnSpec {
  args: string[];
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export interface PiManagerOptions {
  directories: PiRuntimeDirectories;
  logger?: LoggerLike;
  maxRestartAttempts?: number;
  spawnSpec: () => PiManagerSpawnSpec;
  toolHost: PiToolHost;
}

const createBaseStatus = (
  directories: PiRuntimeDirectories,
  financeTools: ReturnType<PiToolHost['getStatus']>,
): PiRuntimeStatus => ({
  currentSessionId: null,
  degraded: false,
  degradedReason: null,
  diagnostics: [],
  directories,
  financeTools,
  lastCheckedAt: null,
  lastError: null,
  lastStartedAt: null,
  model: {
    available: false,
    availableModels: [],
    model: null,
    provider: null,
    source: 'unknown',
  },
  pid: null,
  sessionCount: 0,
  state: 'stopped',
  wrapperVersion: null,
});

const isTerminalRunEvent = (event: PiStreamEvent) => (
  event.type === 'run_completed' || event.type === 'run_failed' || event.type === 'run_cancelled'
);

const normalizeAllowedToolNames = (allowedToolNames?: string[]) => (
  allowedToolNames
    ? new Set(allowedToolNames.filter((toolName) => toolName.trim().length > 0))
    : null
);

export class PiManager {
  private child: ChildProcessWithoutNullStreams | null = null;

  private client: PiClient | null = null;

  private readonly directories: PiRuntimeDirectories;

  private readonly logger?: LoggerLike;

  private lastError: string | null = null;

  private lastStartedAt: string | null = null;

  private readonly maxRestartAttempts: number;

  private readyPromise: Promise<void> | null = null;

  private restartAttempts = 0;

  private shuttingDown = false;

  private readonly spawnSpec: PiManagerOptions['spawnSpec'];

  private state: PiRuntimeStatus['state'] = 'stopped';

  private readonly eventBus = new PiEventBus();

  private readonly runStatusStore = new PiRunStatusStore();

  private readonly sessionTitleStore: PiSessionTitleStore;

  private readonly sessionTitleTasks = new Map<string, Promise<void>>();

  private readonly toolHost: PiToolHost;

  private readonly runToolPolicies = new Map<string, ReadonlySet<string> | null>();

  constructor(options: PiManagerOptions) {
    this.directories = options.directories;
    this.logger = options.logger;
    this.maxRestartAttempts = options.maxRestartAttempts ?? 3;
    this.spawnSpec = options.spawnSpec;
    this.toolHost = options.toolHost;
    this.sessionTitleStore = new PiSessionTitleStore({
      directories: options.directories,
      onError: (error) => {
        this.lastError = error instanceof Error ? error.message : String(error);
      },
    });
  }

  subscribe(listener: (event: PiStreamEvent) => void) {
    return this.eventBus.subscribe(listener);
  }

  async start() {
    if (this.readyPromise) {
      return await this.readyPromise;
    }

    this.readyPromise = this.spawnProcess();

    try {
      await this.readyPromise;
      this.restartAttempts = 0;
    } finally {
      this.readyPromise = null;
    }
  }

  async ensureReady() {
    if (this.child && this.child.exitCode == null && this.state === 'ready') {
      return;
    }

    await this.start();
  }

  async stop() {
    this.shuttingDown = true;

    if (!this.child) {
      this.state = 'stopped';
      return;
    }

    this.client?.dispose();
    this.client = null;

    const child = this.child;
    this.child = null;

    await new Promise<void>((resolve) => {
      child.once('close', () => resolve());
      child.kill('SIGTERM');

      setTimeout(() => {
        if (child.exitCode == null) {
          child.kill('SIGKILL');
        }
      }, 1_500);
    });

    this.state = 'stopped';
  }

  async getStatus(): Promise<PiRuntimeStatus> {
    const base = createBaseStatus(this.directories, this.toolHost.getStatus());
    base.lastError = this.lastError;
    base.lastStartedAt = this.lastStartedAt;
    base.pid = this.child?.pid ?? null;
    base.state = this.state;

    if (!this.client || !this.child || this.child.exitCode != null) {
      return base;
    }

    try {
      const status = await this.client.request('getDiagnostics', undefined);
      this.state = status.state;
      this.lastError = status.lastError;
      return status;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.state = 'error';
      return {
        ...base,
        degraded: true,
        degradedReason: this.lastError,
        lastError: this.lastError,
        state: 'error',
      };
    }
  }

  async listSessions(): Promise<PiWrapperSessionSummary[]> {
    await this.ensureReady();
    return (await this.client!.request('listSessions', undefined)).map((session) => this.resolveSessionSummary(session));
  }

  async listSkills(): Promise<PiWrapperSkillSummary[]> {
    await this.ensureReady();
    return await this.client!.request('listSkills', undefined);
  }

  async getSessionTranscript(sessionId: string): Promise<PiWrapperSessionTranscript> {
    await this.ensureReady();
    return await this.client!.request('getSessionTranscript', { sessionId });
  }

  async listToolInvocations(sessionId: string): Promise<PiToolInvocation[]> {
    await this.ensureReady();
    return await this.client!.request('listToolInvocations', { sessionId });
  }

  async deleteSession(sessionId: string) {
    await this.ensureReady();

    const status = await this.getStatus();

    if (status.currentSessionId === sessionId) {
      throw new Error('Cannot delete the active Pi session.');
    }

    const sessions = await this.listSessions();
    const targetSession = sessions.find((session) => session.id === sessionId);

    if (!targetSession) {
      return false;
    }

    fs.rmSync(targetSession.path, {
      force: true,
      recursive: true,
    });
    fs.rmSync(path.join(this.directories.toolInvocationDir, `${sessionId}.json`), {
      force: true,
      recursive: true,
    });
    this.runStatusStore.delete(sessionId);
    this.sessionTitleStore.delete(sessionId);

    return true;
  }

  async sendMessage(input: PiSendMessageInput): Promise<PiSendMessageResult> {
    await this.ensureReady();
    const result = await this.client!.request('sendMessage', input);

    this.registerRunToolPolicy(result, input);

    return result;
  }

  async cancelRun(runId: string, sessionId: string) {
    await this.ensureReady();
    return await this.client!.request('cancelRun', { runId, sessionId });
  }

  getSessionRunStatus(sessionId: string): PiManagerSessionRunStatus | null {
    return this.runStatusStore.get(sessionId);
  }

  private emit(event: PiStreamEvent) {
    const normalizedEvent = this.normalizeStreamEvent(event);

    if (isTerminalRunEvent(normalizedEvent)) {
      this.runToolPolicies.delete(normalizedEvent.runId);
    }

    this.runStatusStore.apply(normalizedEvent);

    this.eventBus.emit(normalizedEvent);

    if (normalizedEvent.type === 'session_created' && normalizedEvent.session.titleSource !== 'upstream') {
      void this.generateSessionTitle(normalizedEvent.session);
    }
  }

  private resolveSessionSummary(session: PiWrapperSessionSummary): PiWrapperSessionSummary {
    return this.sessionTitleStore.resolveSessionSummary(session);
  }

  private normalizeStreamEvent(event: PiStreamEvent): PiStreamEvent {
    if (event.type === 'session_created') {
      const session = this.sessionTitleStore.prepareSessionCreated(event.session);

      return {
        ...event,
        session,
      };
    }

    if (event.type === 'session_updated') {
      return {
        ...event,
        session: this.resolveSessionSummary(event.session),
      };
    }

    return event;
  }

  private async generateSessionTitle(session: PiWrapperSessionSummary) {
    if (this.sessionTitleTasks.has(session.id) || session.name || session.firstMessage.trim().length === 0) {
      return;
    }

    const task = (async () => {
      const fallbackTitle = this.resolveSessionSummary(session).title ?? null;

      try {
        await this.ensureReady();
        const result = await this.client!.request('generateTitle', {
          cwd: session.cwd,
          message: session.firstMessage,
        });
        const title = this.resolveGeneratedTitle(result, fallbackTitle);

        this.sessionTitleStore.update(session.id, title);
      } catch (error) {
        this.sessionTitleStore.update(session.id, {
          title: fallbackTitle,
          titleSource: 'placeholder',
          titleStatus: 'failed',
          titleUpdatedAt: new Date().toISOString(),
        });
        this.logger?.warn('main', 'Pi title generation failed.', {
          error: error instanceof Error ? error.message : String(error),
          sessionId: session.id,
        });
      } finally {
        this.sessionTitleTasks.delete(session.id);
        this.emit({
          session: this.resolveSessionSummary(session),
          timestamp: new Date().toISOString(),
          type: 'session_updated',
        });
      }
    })();

    this.sessionTitleTasks.set(session.id, task);
  }

  private registerRunToolPolicy(result: PiSendMessageResult, input: PiSendMessageInput) {
    const allowedToolNames = normalizeAllowedToolNames(input.allowedToolNames);

    this.runToolPolicies.set(result.runId, allowedToolNames);
  }

  private async executeToolHostRequest(request: PiToolHostExecuteRequest) {
    if (!this.runToolPolicies.has(request.runId)) {
      throw new Error(`Pi tool request is not associated with a registered run: ${request.runId}`);
    }

    const allowedToolNames = this.runToolPolicies.get(request.runId);

    if (allowedToolNames && !allowedToolNames.has(request.toolName)) {
      throw new Error(`Pi tool is not allowed for this run: ${request.toolName}`);
    }

    return await this.toolHost.execute(request);
  }

  private resolveGeneratedTitle(result: PiGenerateTitleResult, fallbackTitle: string | null): PiSessionTitleMetadata {
    if (result.title) {
      return {
        title: result.title,
        titleSource: 'generated' as const,
        titleStatus: 'ready' as const,
        titleUpdatedAt: new Date().toISOString(),
      };
    }

    return {
      title: fallbackTitle,
      titleSource: 'placeholder' as const,
      titleStatus: 'failed' as const,
      titleUpdatedAt: new Date().toISOString(),
    };
  }

  private async spawnProcess() {
    const spec = this.spawnSpec();
    this.state = 'starting';
    this.lastStartedAt = new Date().toISOString();
    this.shuttingDown = false;

    await new Promise<void>((resolve, reject) => {
      const child = spawn(spec.command, spec.args, {
        cwd: spec.cwd,
        env: spec.env,
        stdio: 'pipe',
      });

      this.child = child;
      this.client = new PiClient({
        input: child.stdout,
        logger: this.logger,
        onNotification: (event) => {
          if (event.type === 'diagnostics_updated') {
            this.lastError = event.status.lastError;
            this.state = event.status.state;
          }

          this.emit(event);
        },
        output: child.stdin,
        requestHandler: async (method, params) => {
          if (method !== 'toolHost.execute') {
            throw new Error(`Unsupported child request: ${method}`);
          }

          return await this.executeToolHostRequest(params as PiToolHostExecuteRequest) as never;
        },
      });

      const handleError = (error: Error) => {
        this.state = 'error';
        this.lastError = error.message;
        this.client?.dispose(error);
        reject(error);
      };

      const handleExit = (code: number | null, signal: NodeJS.Signals | null) => {
        this.client?.dispose(new Error('Agent runtime exited.'));
        this.client = null;
        this.child = null;

        if (this.shuttingDown) {
          return;
        }

        this.state = 'error';
        this.lastError = `Agent runtime exited with code ${code ?? 'null'} signal ${signal ?? 'null'}.`;

        if (this.restartAttempts >= this.maxRestartAttempts) {
          return;
        }

        this.restartAttempts += 1;
        const delay = 250 * 2 ** (this.restartAttempts - 1);

        setTimeout(() => {
          void this.start().catch((error) => {
            this.lastError = error instanceof Error ? error.message : String(error);
          });
        }, delay);
      };

      child.once('error', handleError);
      child.once('exit', handleExit);
      child.stderr.on('data', (chunk) => {
        this.logger?.warn('main', 'Agent runtime stderr', {
          message: chunk.toString('utf8').trim(),
        });
      });

      void this.client.request('health', undefined)
        .then((health) => {
          this.state = 'ready';
          this.lastError = null;
          this.emitDiagnosticsFromHealth(health);
          resolve();
        })
        .catch((error) => {
          this.state = 'error';
          this.lastError = error instanceof Error ? error.message : String(error);
          reject(error);
        });
    });
  }

  private emitDiagnosticsFromHealth(health: PiWrapperHealth) {
    const eventId = crypto.randomUUID();
    void eventId;
    this.emit({
      status: {
        ...createBaseStatus(this.directories, this.toolHost.getStatus()),
        currentSessionId: health.currentSessionId,
        lastCheckedAt: new Date().toISOString(),
        lastError: this.lastError,
        lastStartedAt: this.lastStartedAt,
        pid: health.pid,
        state: this.state,
        wrapperVersion: health.wrapperVersion,
      },
      timestamp: new Date().toISOString(),
      type: 'diagnostics_updated',
    });
  }
}
