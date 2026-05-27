#!/usr/bin/env node

const { StringDecoder } = require('node:string_decoder');

const directories = {
  agentDir: process.env.QUANTDESK_PI_AGENT_DIR || '/tmp/pi-agent/config',
  sessionDir: process.env.QUANTDESK_PI_SESSION_DIR || '/tmp/pi-agent/sessions',
  toolInvocationDir: process.env.QUANTDESK_PI_TOOL_INVOCATION_DIR || '/tmp/pi-agent/tool-invocations',
  workspaceDir: process.env.QUANTDESK_PI_WORKSPACE_DIR || process.cwd(),
};

const status = {
  currentSessionId: 'pi-session-1',
  degraded: false,
  degradedReason: null,
  diagnostics: [],
  directories,
  financeTools: {
    available: true,
    lastError: null,
    names: ['search_assets', 'run_allocation'],
  },
  lastCheckedAt: new Date().toISOString(),
  lastError: null,
  lastStartedAt: new Date().toISOString(),
  model: {
    available: false,
    availableModels: [],
    model: null,
    provider: null,
    source: 'unknown',
  },
  pid: process.pid,
  sessionCount: 1,
  state: 'ready',
  wrapperVersion: 'fake-wrapper',
};

const transcript = {
  cwd: directories.workspaceDir,
  messages: [
    { content: 'hello', id: 'm1', role: 'user' },
    { content: 'hi from fake wrapper', id: 'm2', role: 'assistant' },
  ],
  model: null,
  path: `${directories.sessionDir}/pi-session-1.jsonl`,
  sessionId: 'pi-session-1',
  thinkingLevel: 'off',
};

const invocations = [
  {
    args: { query: 'ETF' },
    error: null,
    finishedAt: new Date().toISOString(),
    result: { ok: true },
    runId: 'fake-run-1',
    sessionId: 'pi-session-1',
    startedAt: new Date().toISOString(),
    status: 'success',
    toolCallId: 'tool-1',
    toolName: 'search_assets',
  },
];

const decoder = new StringDecoder('utf8');
let buffer = '';

const write = (message) => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};

const respond = (id, result) => {
  write({ id, kind: 'response', ok: true, result });
};

const respondError = (id, message) => {
  write({
    error: { code: 'FAKE_ERROR', message },
    id,
    kind: 'response',
    ok: false,
  });
};

const emit = (params) => {
  write({ event: params.type, kind: 'notification', params });
};

const handleMessage = async (message) => {
  if (!message || message.kind !== 'request') {
    return;
  }

  switch (message.method) {
    case 'health':
      respond(message.id, {
        currentSessionId: 'pi-session-1',
        directories,
        ok: true,
        pid: process.pid,
        wrapperVersion: 'fake-wrapper',
      });
      return;
    case 'getDiagnostics':
      respond(message.id, status);
      return;
    case 'listSessions':
      respond(message.id, [{
        cwd: directories.workspaceDir,
        firstMessage: 'hello',
        id: 'pi-session-1',
        modifiedAt: new Date().toISOString(),
        name: null,
        path: transcript.path,
      }]);
      return;
    case 'getSessionTranscript':
      respond(message.id, transcript);
      return;
    case 'generateTitle':
      respond(message.id, { title: 'Fake Generated Title' });
      return;
    case 'listToolInvocations':
      respond(message.id, invocations);
      return;
    case 'cancelRun':
      respond(message.id, { cancelled: true });
      return;
    case 'sendMessage': {
      respond(message.id, { runId: 'fake-run-1', sessionId: 'pi-session-1' });
      setTimeout(() => {
        emit({
          session: {
            cwd: directories.workspaceDir,
            firstMessage: message.params?.message || '',
            id: 'pi-session-1',
            modifiedAt: new Date().toISOString(),
            name: null,
            path: transcript.path,
          },
          timestamp: new Date().toISOString(),
          type: 'session_created',
        });
        emit({
          message: message.params?.message || '',
          runId: 'fake-run-1',
          sessionId: 'pi-session-1',
          timestamp: new Date().toISOString(),
          type: 'run_started',
        });
        emit({
          delta: 'stream chunk',
          messageId: 'm3',
          phase: 'assistant',
          runId: 'fake-run-1',
          sessionId: 'pi-session-1',
          timestamp: new Date().toISOString(),
          type: 'message_delta',
        });
        emit({
          runId: 'fake-run-1',
          sessionId: 'pi-session-1',
          timestamp: new Date().toISOString(),
          transcript: {
            ...transcript,
            messages: [...transcript.messages, { content: 'stream chunk', id: 'm3', role: 'assistant' }],
          },
          type: 'run_completed',
        });
      }, 5);
      return;
    }
    default:
      respondError(message.id, `Unknown method: ${message.method}`);
  }
};

process.stdin.on('data', (chunk) => {
  buffer += typeof chunk === 'string' ? chunk : decoder.write(chunk);

  while (true) {
    const newlineIndex = buffer.indexOf('\n');

    if (newlineIndex === -1) {
      break;
    }

    let line = buffer.slice(0, newlineIndex);
    buffer = buffer.slice(newlineIndex + 1);

    if (line.endsWith('\r')) {
      line = line.slice(0, -1);
    }

    if (!line.trim()) {
      continue;
    }

    handleMessage(JSON.parse(line)).catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
    });
  }
});

process.stdin.on('end', () => {
  process.exit(0);
});