import { once } from 'node:events';
import { spawn } from 'node:child_process';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import { electronE2EArgs, electronE2EEnv, electronE2EPath } from './electron-e2e';

interface ProbePayload {
  firstSymbol: string | null;
  lookupCount: number;
  runtimeStatus: {
    lastError: string | null;
    logDir: string | null;
    sidecarPid: number | null;
    sidecarPort: number | null;
    sidecarReady: boolean;
  };
}

const workspaceRoot = process.cwd();
const electronEntry = path.join(workspaceRoot, 'packages/main/dist/index.js');

const waitForExit = async (pid: number, timeoutMs = 8_000) => {
  const startedAt = Date.now();

  for (; ;) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }

    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for process ${pid} to exit.`);
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

describe('sidecar electron e2e', () => {
  test('launches the real Electron app, reaches sidecar ready state, and shuts the sidecar down on quit', async () => {
    const child = spawn(electronE2EPath, electronE2EArgs(electronEntry), {
      cwd: workspaceRoot,
      env: electronE2EEnv({
        QUANTDESK_E2E_SIDECAR_PROBE: '1',
      }),
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

    const [exitCode] = (await once(child, 'close')) as [number | null];

    expect(exitCode).toBe(0);

    const probeLine = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.includes('"type":"sidecar-e2e-probe"'));

    expect(probeLine, stderr || stdout).toBeTruthy();

    const parsed = JSON.parse(probeLine!) as {
      payload: ProbePayload;
      type: string;
    };

    expect(parsed.type).toBe('sidecar-e2e-probe');
    expect(parsed.payload.runtimeStatus.sidecarReady).toBe(true);
    expect(parsed.payload.runtimeStatus.sidecarPid).toEqual(expect.any(Number));
    expect(parsed.payload.runtimeStatus.sidecarPort).toEqual(expect.any(Number));
    expect(parsed.payload.runtimeStatus.lastError).toBeNull();
    expect(parsed.payload.runtimeStatus.logDir).toEqual(expect.any(String));
    expect(parsed.payload.lookupCount).toBeGreaterThan(0);
    expect(parsed.payload.firstSymbol).toBe('SPY');

    await waitForExit(parsed.payload.runtimeStatus.sidecarPid!);
  }, 30_000);
});