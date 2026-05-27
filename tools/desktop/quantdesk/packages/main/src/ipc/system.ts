import { spawn } from 'node:child_process';

import type {
  DummyPythonResponse,
  MetadataBackfillStatus,
  NativeCheckResponse,
  PingResponse,
  RuntimeStatusResponse,
} from '@quantdesk/shared';

import { readInMemorySqliteVersion } from '../db/database';
import type { ContractBinder } from './contract-binder';

export interface SystemHandlers {
  ping: () => Promise<PingResponse>;
  checkNativeBindings: () => Promise<NativeCheckResponse>;
  runDummyPython: () => Promise<DummyPythonResponse>;
  getRuntimeStatus: () => Promise<RuntimeStatusResponse>;
}

export interface SystemDependencies {
  getAppVersion: () => string;
  getSqliteVersion: () => string;
  resolveDummyScriptPath: () => string;
  runDummyPython: (scriptPath: string) => Promise<DummyPythonResponse>;
  getRuntimeStatus: () => Promise<RuntimeStatusResponse> | RuntimeStatusResponse;
}

export const createSystemHandlers = ({
  getAppVersion,
  getSqliteVersion,
  resolveDummyScriptPath,
  runDummyPython,
  getRuntimeStatus,
}: SystemDependencies): SystemHandlers => ({
  async ping() {
    return {
      appVersion: getAppVersion(),
      message: 'pong',
      timestamp: new Date().toISOString(),
    };
  },
  async checkNativeBindings() {
    return {
      driver: 'better-sqlite3',
      memoryDbReady: true,
      sqliteVersion: getSqliteVersion(),
    };
  },
  async runDummyPython() {
    return runDummyPython(resolveDummyScriptPath());
  },
  async getRuntimeStatus() {
    return await getRuntimeStatus();
  },
});

export const createDefaultSystemDependencies = (
  getAppVersion: () => string,
  resolveDummyScriptPath: () => string,
): SystemDependencies => ({
  getAppVersion,
  getSqliteVersion: () => readInMemorySqliteVersion(),
  getRuntimeStatus: () => ({
    lastError: null,
    logDir: null,
    metadataBackfill: {
      completedAt: null,
      failedAssets: 0,
      lastError: null,
      scannedAssets: 0,
      startedAt: null,
      state: 'idle',
      updatedAssets: 0,
    } satisfies MetadataBackfillStatus,
    sidecarPid: null,
    sidecarPort: null,
    sidecarReady: false,
    quantData: {
      lastError: null,
      providerConfiguration: {
        code: 'RUNTIME_UNAVAILABLE',
        message: 'quant-data runtime is not configured.',
        ready: false,
      },
      ready: false,
    },
  }),
  resolveDummyScriptPath,
  runDummyPython: runDummyPythonScript,
});

export const registerSystemIpc = (
  binder: ContractBinder,
  handlers: SystemHandlers,
) => {
  binder.registerInvokeNamespace('system', handlers);
};

const runDummyPythonScript = async (
  scriptPath: string,
): Promise<DummyPythonResponse> =>
  new Promise((resolve, reject) => {
    const command = 'python3';
    const child = spawn(command, [scriptPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (exitCode) => {
      resolve({
        command,
        exitCode: exitCode ?? -1,
        scriptPath,
        stderr: stderr.trim(),
        stdout: stdout.trim(),
      });
    });
  });
