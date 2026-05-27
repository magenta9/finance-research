import process from 'node:process';

import { PiWrapperServer } from './server';
import type { PiRuntimeDirectories } from '../types';

const resolveRequiredEnv = (name: string) => {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required pi wrapper environment variable: ${name}`);
  }

  return value;
};

const createDirectories = (): PiRuntimeDirectories => ({
  agentDir: resolveRequiredEnv('QUANTDESK_PI_AGENT_DIR'),
  sessionDir: resolveRequiredEnv('QUANTDESK_PI_SESSION_DIR'),
  toolInvocationDir: resolveRequiredEnv('QUANTDESK_PI_TOOL_INVOCATION_DIR'),
  workspaceDir: resolveRequiredEnv('QUANTDESK_PI_WORKSPACE_DIR'),
});

const main = async () => {
  const server = new PiWrapperServer(createDirectories());

  const shutdown = async (exitCode: number) => {
    try {
      await server.dispose();
    } finally {
      process.exit(exitCode);
    }
  };

  process.on('SIGTERM', () => {
    void shutdown(0);
  });
  process.on('SIGINT', () => {
    void shutdown(0);
  });

  await server.run();
};

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});