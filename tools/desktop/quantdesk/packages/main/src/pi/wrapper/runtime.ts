import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type {
  AgentSessionRuntime,
  CreateAgentSessionRuntimeFactory,
  ModelRegistry,
} from '@mariozechner/pi-coding-agent';
import { asString, isRecord } from '@quantdesk/shared/type-guards';

import {
  buildConversationTitleState,
  normalizeGeneratedConversationTitle,
} from '@quantdesk/shared';

import { financeToolDefinitions } from '../../agent/capabilities/finance';
import {
  choosePreferredPiFailureMessage,
} from '../error-normalization';
import { buildPiToolResult, createPiToolProgressUpdate } from '../tool-bridge';
import {
  getPiTranscriptFailureMessage,
  hasPiTranscriptTerminalAssistantResponse,
  normalizePiTranscriptMessages,
} from './transcript';
import { buildPromptWithAttachments } from './prompt';
import {
  convertSchemaToPiType,
  createDefaultStatus,
  toIsoString,
} from './runtime-helpers';
import { PiWrapperToolInvocationStore } from './tool-invocation-store';
import type {
  PiRuntimeDirectories,
  PiRuntimeStatus,
  PiGenerateTitleInput,
  PiGenerateTitleResult,
  PiSendMessageInput,
  PiSendMessageResult,
  PiWrapperSessionSummary,
  PiWrapperSessionTranscript,
  PiStreamEvent,
  PiToolHostExecuteRequest,
  PiToolHostExecuteResponse,
  PiToolInvocation,
  PiWrapperHealth,
  PiWrapperSkillSummary,
} from '../types';

type PiCodingAgentModule = typeof import('@mariozechner/pi-coding-agent');
type PiAiModule = typeof import('@mariozechner/pi-ai');

interface PiRuntimeModel {
  id: string;
  provider: string;
}

const agentSkillDirectoryRelativePath = path.join('.agent', 'skills');
const agentsSkillDirectoryRelativePath = path.join('.agents', 'skills');
const skillFileName = 'SKILL.md';
const piSkillPathsEnvKey = 'QUANTDESK_PI_SKILL_PATHS';

interface PiWrapperRuntimeOptions {
  directories: PiRuntimeDirectories;
  emitEvent: (event: PiStreamEvent) => void;
  requestHost: (request: PiToolHostExecuteRequest) => Promise<PiToolHostExecuteResponse>;
}

export class PiWrapperRuntime {
  private ai: PiAiModule | null = null;

  private currentRun: {
    allowedToolNames: Set<string> | null;
    cancelRequested: boolean;
    messageId: string;
    runId: string;
    sessionId: string;
  } | null = null;

  private lastError: string | null = null;

  private lastStartedAt: string | null = null;

  private modelRegistry: ModelRegistry | null = null;

  private readonly options: PiWrapperRuntimeOptions;

  private runtime: AgentSessionRuntime | null = null;

  private sdk: PiCodingAgentModule | null = null;

  private sessionSubscription: (() => void) | null = null;

  private readonly toolInvocations: PiWrapperToolInvocationStore;

  constructor(options: PiWrapperRuntimeOptions) {
    this.options = options;
    this.toolInvocations = new PiWrapperToolInvocationStore({
      directories: options.directories,
      emitEvent: options.emitEvent,
      onError: (error) => {
        this.lastError = error instanceof Error ? error.message : String(error);
      },
    });
    this.ensureDirectories();
  }

  private resolveActiveModel(): PiRuntimeModel | null {
    const runtimeModel = this.normalizeRuntimeModel(this.runtime?.session?.model);

    if (runtimeModel) {
      return runtimeModel;
    }

    const sessionManager = this.runtime?.session?.sessionManager;

    if (!sessionManager || typeof sessionManager.buildSessionContext !== 'function') {
      return null;
    }

    try {
      const context = sessionManager.buildSessionContext();

      return isRecord(context) ? this.normalizeRuntimeModel(context.model) : null;
    } catch (error) {
      console.error('[pi-wrapper] failed to read session model context', error);
      return null;
    }
  }

  private normalizeRuntimeModel(model: unknown): PiRuntimeModel | null {
    if (!isRecord(model)) {
      return null;
    }

    const id = asString(model.id) || asString(model.modelId);
    const provider = asString(model.provider);

    return id && provider ? { id, provider } : null;
  }

  private findSkillDirectories(startDir: string, relativePath: string) {
    let current = path.resolve(startDir);
    const paths: string[] = [];
    const seen = new Set<string>();

    for (; ;) {
      const candidate = path.join(current, relativePath);

      try {
        const realPath = fs.realpathSync(candidate);

        if (fs.statSync(realPath).isDirectory() && !seen.has(realPath)) {
          seen.add(realPath);
          paths.push(candidate);
        }
      } catch (error) {
        void error;
        // Keep walking ancestors until all project-level skill directories are found.
      }

      if (current === path.dirname(current)) {
        return paths;
      }

      current = path.dirname(current);
    }
  }

  private getConfiguredSkillResourcePaths() {
    return (process.env[piSkillPathsEnvKey] ?? '')
      .split(path.delimiter)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  private getPiSkillResourcePaths(cwd: string) {
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    const candidates = [
      path.join(this.options.directories.agentDir, agentSkillDirectoryRelativePath),
      path.join(this.options.directories.agentDir, agentsSkillDirectoryRelativePath),
      ...this.getConfiguredSkillResourcePaths(),
      ...this.findSkillDirectories(cwd, agentSkillDirectoryRelativePath),
      ...this.findSkillDirectories(cwd, agentsSkillDirectoryRelativePath),
      ...this.findSkillDirectories(process.cwd(), agentSkillDirectoryRelativePath),
      ...this.findSkillDirectories(process.cwd(), agentsSkillDirectoryRelativePath),
      ...this.findSkillDirectories(__dirname, agentSkillDirectoryRelativePath),
      ...this.findSkillDirectories(__dirname, agentsSkillDirectoryRelativePath),
      resourcesPath ? path.join(resourcesPath, agentSkillDirectoryRelativePath) : null,
      resourcesPath ? path.join(resourcesPath, agentsSkillDirectoryRelativePath) : null,
      resourcesPath ? path.join(resourcesPath, 'app.asar.unpacked', agentSkillDirectoryRelativePath) : null,
      resourcesPath ? path.join(resourcesPath, 'app.asar.unpacked', agentsSkillDirectoryRelativePath) : null,
    ];
    const paths: string[] = [];
    const seen = new Set<string>();

    for (const candidate of candidates) {
      if (!candidate) {
        continue;
      }

      try {
        const realPath = fs.realpathSync(candidate);

        if (seen.has(realPath) || !fs.statSync(realPath).isDirectory()) {
          continue;
        }

        seen.add(realPath);
      } catch (error) {
        void error;
        continue;
      }

      paths.push(candidate);
    }

    return paths.length > 0 ? paths : [path.join(path.resolve(cwd), agentsSkillDirectoryRelativePath)];
  }

  private getResourceLoaderOptions(cwd: string) {
    return {
      additionalSkillPaths: this.getPiSkillResourcePaths(cwd),
    };
  }

  private readSkillSummary(skillPath: string, source: string): PiWrapperSkillSummary | null {
    const markdownPath = path.join(skillPath, skillFileName);

    try {
      const content = fs.readFileSync(markdownPath, 'utf8');
      const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      const frontmatter = frontmatterMatch?.[1] ?? '';
      const metadata = new Map<string, string>();

      for (const line of frontmatter.split(/\r?\n/)) {
        const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);

        if (match) {
          metadata.set(match[1], match[2].replace(/^["']|["']$/g, '').trim());
        }
      }

      return {
        description: metadata.get('description') || null,
        name: metadata.get('name') || path.basename(skillPath),
        path: markdownPath,
        source,
      };
    } catch (error) {
      void error;
      return null;
    }
  }

  async health(): Promise<PiWrapperHealth> {
    await this.ensureSdk();

    return {
      currentSessionId: this.runtime?.session?.sessionId ?? null,
      directories: this.options.directories,
      ok: true,
      pid: process.pid,
      wrapperVersion: this.sdk ? '0.68.0' : null,
    };
  }

  async getDiagnostics(): Promise<PiRuntimeStatus> {
    const [sessions, models] = await Promise.all([
      this.listSessions(),
      this.getAvailableModels(),
    ]);
    const activeModel = this.resolveActiveModel();

    return createDefaultStatus(this.options.directories, sessions.length, financeToolDefinitions.map((definition) => definition.name), {
      currentSessionId: this.runtime?.session?.sessionId ?? null,
      degraded: Boolean(this.lastError),
      degradedReason: this.lastError,
      diagnostics: this.runtime?.diagnostics?.map((diagnostic) => ({
        level: diagnostic.type === 'error' ? 'error' : diagnostic.type === 'warning' ? 'warning' : 'info',
        message: asString(diagnostic.message) || 'Unknown diagnostic',
        source: 'pi-runtime',
      })) ?? [],
      lastCheckedAt: new Date().toISOString(),
      lastError: this.lastError,
      lastStartedAt: this.lastStartedAt,
      model: {
        available: Boolean(activeModel) || models.length > 0,
        availableModels: models.map((model) => `${model.provider}/${model.id}`).filter(Boolean),
        model: activeModel ? asString(activeModel.id) : null,
        provider: activeModel ? asString(activeModel.provider) : null,
        source: activeModel ? 'runtime' : 'unknown',
      },
      pid: process.pid,
      state: 'ready',
      wrapperVersion: '0.68.0',
    });
  }

  async listSessions(): Promise<PiWrapperSessionSummary[]> {
    const sdk = await this.ensureSdk();
    const sessions = await sdk.SessionManager.list(
      this.options.directories.workspaceDir,
      this.options.directories.sessionDir,
    );

    return sessions.map((session) => ({
      cwd: asString(session.cwd) || this.options.directories.workspaceDir,
      firstMessage: asString(session.firstMessage),
      id: asString(session.id),
      modifiedAt: session.modified instanceof Date
        ? session.modified.toISOString()
        : toIsoString(session.modified),
      name: asString(session.name) || null,
      path: asString(session.path),
      ...buildConversationTitleState({
        title: asString(session.name) || null,
        titleSource: asString(session.name) ? 'upstream' : 'placeholder',
        titleStatus: 'ready',
        titleUpdatedAt: session.modified instanceof Date
          ? session.modified.toISOString()
          : toIsoString(session.modified),
      }),
    }));
  }

  async listSkills(): Promise<PiWrapperSkillSummary[]> {
    const skills = new Map<string, PiWrapperSkillSummary>();

    for (const skillRoot of this.getPiSkillResourcePaths(this.options.directories.workspaceDir)) {
      let entries: fs.Dirent[];

      try {
        entries = fs.readdirSync(skillRoot, { withFileTypes: true });
      } catch (error) {
        void error;
        continue;
      }

      for (const entry of entries) {
        const skillPath = path.join(skillRoot, entry.name);

        try {
          if (!fs.statSync(skillPath).isDirectory()) {
            continue;
          }
        } catch (error) {
          void error;
          continue;
        }

        const summary = this.readSkillSummary(skillPath, skillRoot);

        if (summary && !skills.has(summary.name)) {
          skills.set(summary.name, summary);
        }
      }
    }

    return [...skills.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  async getSessionTranscript(sessionId: string): Promise<PiWrapperSessionTranscript> {
    const sdk = await this.ensureSdk();
    const activeRuntime = this.runtime;

    if (activeRuntime?.session.sessionId === sessionId) {
      return this.buildTranscript(
        sessionId,
        activeRuntime.session.sessionManager.getSessionFile() ?? '',
        activeRuntime.session.sessionManager.getCwd(),
        activeRuntime.session.messages,
        activeRuntime.session.thinkingLevel ?? 'off',
        this.resolveActiveModel(),
      );
    }

    const session = await this.findSession(sessionId);

    if (!session) {
      throw new Error(`Unknown pi session: ${sessionId}`);
    }

    const sessionManager = sdk.SessionManager.open(
      session.path,
      this.options.directories.sessionDir,
      session.cwd,
    );
    const context = sessionManager.buildSessionContext();

    return this.buildTranscript(
      sessionId,
      session.path,
      session.cwd,
      context.messages,
      asString(context.thinkingLevel) || 'off',
      this.normalizeRuntimeModel(context.model),
    );
  }

  async listToolInvocations(sessionId: string): Promise<PiToolInvocation[]> {
    return this.toolInvocations.list(sessionId);
  }

  async generateTitle(input: PiGenerateTitleInput): Promise<PiGenerateTitleResult> {
    await this.ensureSdk();

    const sdk = this.sdk!;
    const runtimeRoot = path.join(this.options.directories.agentDir, 'title-generation', crypto.randomUUID());
    const runtimeSessionDir = path.join(runtimeRoot, 'sessions');
    const runtimeCwd = input.cwd ?? this.options.directories.workspaceDir;

    fs.mkdirSync(runtimeSessionDir, { recursive: true });

    const createRuntime: CreateAgentSessionRuntimeFactory = async ({
      cwd,
      sessionManager,
      sessionStartEvent,
    }) => {
      const services = await sdk.createAgentSessionServices({
        agentDir: this.options.directories.agentDir,
        authStorage: this.getAuthStorage(),
        cwd,
        modelRegistry: this.getModelRegistry(),
        resourceLoaderOptions: this.getResourceLoaderOptions(cwd),
      });
      return {
        ...(await sdk.createAgentSessionFromServices({
          customTools: [],
          services,
          sessionManager,
          sessionStartEvent,
        })),
        diagnostics: services.diagnostics,
        services,
      };
    };
    const sessionManager = sdk.SessionManager.create(runtimeCwd, runtimeSessionDir);
    const runtime = await sdk.createAgentSessionRuntime(createRuntime, {
      agentDir: this.options.directories.agentDir,
      cwd: runtimeCwd,
      sessionManager,
    });

    try {
      await runtime.session.bindExtensions({});
      await runtime.session.prompt([
        '请根据下面这条用户消息生成一个简洁中文会话主题。',
        '要求：',
        '1. 只输出一个主题，不要解释。',
        '2. 长度控制在 6 到 12 个中文字符。',
        '3. 不要使用引号、句号、编号或前缀。',
        `用户消息：${input.message}`,
      ].join('\n'));

      const transcript = this.buildTranscript(
        runtime.session.sessionId,
        runtime.session.sessionManager.getSessionFile() ?? '',
        runtime.session.sessionManager.getCwd(),
        runtime.session.messages,
        runtime.session.thinkingLevel ?? 'off',
        runtime.session.model ?? null,
      );
      const latestAssistantMessage = [...transcript.messages]
        .reverse()
        .find((message) => message.role === 'assistant' && message.phase !== 'thinking' && !message.isError && message.content.trim().length > 0);

      return {
        title: normalizeGeneratedConversationTitle(latestAssistantMessage?.content ?? ''),
      };
    } finally {
      await runtime.dispose();
      fs.rmSync(runtimeRoot, { force: true, recursive: true });
    }
  }

  async sendMessage(input: PiSendMessageInput): Promise<PiSendMessageResult> {
    if (this.currentRun) {
      throw new Error('Agent runtime already has an active run.');
    }

    await this.ensureRuntimeForSession(input.sessionId, input.startNewSession === true);

    const session = this.getActiveRuntime().session;
    const sessionId = asString(session.sessionId);
    const promptInput = buildPromptWithAttachments(input);
    const runId = crypto.randomUUID();
    const hadEntries = session.sessionManager.getEntries().length > 0;
    this.lastStartedAt = new Date().toISOString();
    this.currentRun = {
      allowedToolNames: input.allowedToolNames ? new Set(input.allowedToolNames) : null,
      cancelRequested: false,
      messageId: `${sessionId}:assistant:${runId}`,
      runId,
      sessionId,
    };

    if (!hadEntries) {
      this.options.emitEvent({
        session: await this.buildCurrentSessionSummary(),
        timestamp: new Date().toISOString(),
        type: 'session_created',
      });
    }

    this.options.emitEvent({
      message: input.message,
      runId,
      sessionId,
      timestamp: new Date().toISOString(),
      type: 'run_started',
    });

    void session.prompt(promptInput.message, promptInput.images.length > 0 ? { images: promptInput.images } : undefined)
      .then(async () => {
        const transcript = await this.getSessionTranscript(sessionId);
        const latestRunInvocation = this.toolInvocations.getLatestForRun(sessionId, runId);
        const failedRunInvocation = !hasPiTranscriptTerminalAssistantResponse(transcript)
          && latestRunInvocation?.status === 'error'
          ? latestRunInvocation
          : null;
        const failureMessage = choosePreferredPiFailureMessage(
          getPiTranscriptFailureMessage(transcript),
          failedRunInvocation,
        );
        this.currentRun = null;

        if (failureMessage) {
          this.lastError = failureMessage;
          this.options.emitEvent({
            error: failureMessage,
            runId,
            sessionId,
            timestamp: new Date().toISOString(),
            type: 'run_failed',
          });
          await this.emitDiagnosticsUpdated();
          return;
        }

        this.lastError = null;

        this.options.emitEvent({
          runId,
          sessionId,
          timestamp: new Date().toISOString(),
          transcript,
          type: 'run_completed',
        });
        await this.emitDiagnosticsUpdated();
      })
      .catch(async (error: unknown) => {
        const wasCancelled = this.currentRun?.cancelRequested ?? false;
        const timestamp = new Date().toISOString();
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.currentRun = null;
        this.lastError = wasCancelled ? null : errorMessage;

        if (wasCancelled) {
          this.toolInvocations.markRunCancelled(sessionId, runId, timestamp);
          this.options.emitEvent({
            runId,
            sessionId,
            timestamp,
            type: 'run_cancelled',
          });
        } else {
          this.options.emitEvent({
            error: errorMessage,
            runId,
            sessionId,
            timestamp,
            type: 'run_failed',
          });
        }

        await this.emitDiagnosticsUpdated();
      });

    return { runId, sessionId };
  }

  async cancelRun(input: { runId: string; sessionId: string }) {
    if (!this.currentRun || this.currentRun.runId !== input.runId || this.currentRun.sessionId !== input.sessionId) {
      return { cancelled: false };
    }

    this.currentRun.cancelRequested = true;
    await this.runtime?.session?.abort?.();
    return { cancelled: true };
  }

  async dispose() {
    this.sessionSubscription?.();
    this.sessionSubscription = null;

    if (this.runtime) {
      await this.runtime.dispose();
      this.runtime = null;
    }
  }

  private buildTranscript(
    sessionId: string,
    sessionPath: string,
    cwd: string,
    messages: unknown[],
    thinkingLevel: string,
    model: PiRuntimeModel | null,
  ): PiWrapperSessionTranscript {
    return {
      cwd,
      messages: normalizePiTranscriptMessages(sessionId, messages),
      model: model
        ? {
          modelId: asString(model.id),
          provider: asString(model.provider),
        }
        : null,
      path: sessionPath,
      sessionId,
      thinkingLevel,
    };
  }

  private async buildCurrentSessionSummary(): Promise<PiWrapperSessionSummary> {
    const transcript = await this.getSessionTranscript(this.getActiveRuntime().session.sessionId);
    const firstUserMessage = transcript.messages.find((message) => message.role === 'user');
    return {
      cwd: transcript.cwd,
      firstMessage: firstUserMessage?.content ?? '',
      id: transcript.sessionId,
      modifiedAt: new Date().toISOString(),
      name: null,
      path: transcript.path,
      ...buildConversationTitleState({
        title: null,
        titleSource: 'placeholder',
        titleStatus: 'pending',
        titleUpdatedAt: new Date().toISOString(),
      }),
    };
  }

  private getSessionManagerFile(sessionManager: unknown) {
    const maybeSessionManager = sessionManager as { getSessionFile?: () => string | null };

    return maybeSessionManager.getSessionFile?.() ?? null;
  }

  private async ensureRuntimeForSession(sessionId?: string, startNewSession = false) {
    const sdk = await this.ensureSdk();

    if (sessionId && startNewSession) {
      throw new Error('Cannot start a new Pi session while targeting an existing session id.');
    }

    if (!this.runtime) {
      const targetSession = sessionId ? await this.findSession(sessionId) : null;
      const sessionManager = targetSession
        ? sdk.SessionManager.open(targetSession.path, this.options.directories.sessionDir, targetSession.cwd)
        : sdk.SessionManager.create(this.options.directories.workspaceDir, this.options.directories.sessionDir);
      const cwd = targetSession?.cwd ?? this.options.directories.workspaceDir;
      const createRuntime: CreateAgentSessionRuntimeFactory = async ({
        cwd: runtimeCwd,
        sessionManager: runtimeSessionManager,
        sessionStartEvent,
      }) => {
        const services = await sdk.createAgentSessionServices({
          agentDir: this.options.directories.agentDir,
          authStorage: this.getAuthStorage(),
          cwd: runtimeCwd,
          modelRegistry: this.getModelRegistry(),
          resourceLoaderOptions: this.getResourceLoaderOptions(runtimeCwd),
        });
        return {
          ...(await sdk.createAgentSessionFromServices({
            customTools: this.createCustomTools(),
            services,
            sessionManager: runtimeSessionManager,
            sessionStartEvent,
          })),
          diagnostics: services.diagnostics,
          services,
        };
      };

      this.runtime = await sdk.createAgentSessionRuntime(createRuntime, {
        agentDir: this.options.directories.agentDir,
        cwd,
        sessionManager,
      });
      await this.bindRuntimeSession();
      return;
    }

    if (startNewSession) {
      const sessionManager = sdk.SessionManager.create(this.options.directories.workspaceDir, this.options.directories.sessionDir);
      const sessionPath = this.getSessionManagerFile(sessionManager);

      if (!sessionPath) {
        throw new Error('Failed to create isolated Pi session.');
      }

      await this.runtime.switchSession(sessionPath, this.options.directories.workspaceDir);
      await this.bindRuntimeSession();
      return;
    }

    if (sessionId && this.runtime.session.sessionId !== sessionId) {
      const targetSession = await this.findSession(sessionId);

      if (!targetSession) {
        throw new Error(`Unknown pi session: ${sessionId}`);
      }

      await this.runtime.switchSession(targetSession.path, targetSession.cwd);
      await this.bindRuntimeSession();
    }
  }

  private async bindRuntimeSession() {
    const runtime = this.getActiveRuntime();

    await runtime.session.bindExtensions({});
    this.sessionSubscription?.();
    this.sessionSubscription = runtime.session.subscribe((event: Record<string, unknown>) => {
      if (event.type === 'message_update') {
        const assistantEvent = isRecord(event.assistantMessageEvent) ? event.assistantMessageEvent : null;
        const eventType = assistantEvent ? asString(assistantEvent.type) : '';

        // Only forward visible text (text_delta) and reasoning (thinking_delta).
        // toolcall_delta / start / end / done events stream raw JSON tool args
        // that must NOT be appended to the assistant's answer content.
        if (eventType !== 'text_delta' && eventType !== 'thinking_delta') {
          return;
        }

        const delta = assistantEvent ? asString(assistantEvent.delta) : '';

        if (!delta || !this.currentRun) {
          return;
        }

        const phase = eventType === 'thinking_delta' ? 'thinking' : 'assistant';
        this.options.emitEvent({
          delta,
          messageId: this.currentRun.messageId,
          phase,
          runId: this.currentRun.runId,
          sessionId: this.currentRun.sessionId,
          timestamp: new Date().toISOString(),
          type: 'message_delta',
        });
        return;
      }

      if (event.type === 'tool_execution_start') {
        this.toolInvocations.recordToolStart(event, this.getToolInvocationContext());
        return;
      }

      if (event.type === 'tool_execution_update') {
        this.toolInvocations.recordToolUpdate(event, this.getToolInvocationContext());
        return;
      }

      if (event.type === 'tool_execution_end') {
        this.toolInvocations.recordToolEnd(event, this.getToolInvocationContext());
      }
    });
  }

  private getToolInvocationContext() {
    return {
      runId: this.currentRun?.runId ?? null,
      sessionId: this.runtime?.session?.sessionId ?? this.currentRun?.sessionId ?? 'unknown-session',
    };
  }

  private isToolAllowedForCurrentRun(toolName: string) {
    const allowedToolNames = this.currentRun?.allowedToolNames;

    return !allowedToolNames || allowedToolNames.has(toolName);
  }

  private createCustomTools() {
    const sdk = this.sdk!;
    const ai = this.ai!;
    const Type = (ai as Record<string, unknown>).Type as Record<string, (...args: unknown[]) => unknown>;
    const stringEnum = (ai as Record<string, unknown>).StringEnum as ((values: string[], options?: Record<string, unknown>) => unknown) | undefined;

    return financeToolDefinitions.map((definition) => sdk.defineTool({
      description: definition.description,
      label: definition.name,
      name: definition.name,
      parameters: convertSchemaToPiType(definition.inputSchema, Type, stringEnum) as never,
      promptSnippet: definition.description,
      execute: (async (
        toolCallId: string,
        params: unknown,
        _signal?: AbortSignal,
        onUpdate?: (payload: unknown) => void,
      ) => {
        if (!this.isToolAllowedForCurrentRun(definition.name)) {
          throw new Error(`Pi tool is not allowed for this run: ${definition.name}`);
        }

        onUpdate?.(createPiToolProgressUpdate('调用 QuantDesk 金融能力层...', {
          stage: 'dispatch',
          toolName: definition.name,
        }) as never);

        const response = await this.options.requestHost({
          args: isRecord(params) ? params : {},
          runId: this.currentRun?.runId ?? crypto.randomUUID(),
          sessionId: this.runtime?.session?.sessionId ?? 'unknown-session',
          toolCallId,
          toolName: definition.name,
        });

        return buildPiToolResult(response.payload) as never;
      }) as never,
    }));
  }

  private async emitDiagnosticsUpdated() {
    this.options.emitEvent({
      status: await this.getDiagnostics(),
      timestamp: new Date().toISOString(),
      type: 'diagnostics_updated',
    });
  }

  private ensureDirectories() {
    fs.mkdirSync(this.options.directories.agentDir, { recursive: true });
    fs.mkdirSync(this.options.directories.sessionDir, { recursive: true });
    fs.mkdirSync(this.options.directories.toolInvocationDir, { recursive: true });
    fs.mkdirSync(this.options.directories.workspaceDir, { recursive: true });
  }

  private async ensureSdk() {
    if (!this.sdk || !this.ai) {
      [this.sdk, this.ai] = await Promise.all([
        // Runtime SDK packages are ESM-only while this process is emitted as CJS.
        // eslint-disable-next-line quantdesk/no-runtime-dynamic-import
        import('@mariozechner/pi-coding-agent'),
        // eslint-disable-next-line quantdesk/no-runtime-dynamic-import
        import('@mariozechner/pi-ai'),
      ]);
    }

    return this.sdk;
  }

  private async findSession(sessionId: string) {
    const sessions = await this.listSessions();
    return sessions.find((session) => session.id === sessionId) ?? null;
  }

  private async getAvailableModels() {
    await this.ensureSdk();
    const modelRegistry = this.getModelRegistry();
    return await modelRegistry.getAvailable();
  }

  private getAuthStorage() {
    if (!this.sdk) {
      throw new Error('Agent runtime not initialized.');
    }

    return this.sdk.AuthStorage.create(path.join(this.options.directories.agentDir, 'auth.json'));
  }

  private getActiveRuntime() {
    if (!this.runtime) {
      throw new Error('Agent runtime not initialized.');
    }

    return this.runtime;
  }

  private getModelRegistry() {
    if (!this.sdk) {
      throw new Error('Agent runtime not initialized.');
    }

    if (!this.modelRegistry) {
      this.modelRegistry = this.sdk.ModelRegistry.create(
        this.getAuthStorage(),
        path.join(this.options.directories.agentDir, 'models.json'),
      );
    }

    return this.modelRegistry;
  }

}
