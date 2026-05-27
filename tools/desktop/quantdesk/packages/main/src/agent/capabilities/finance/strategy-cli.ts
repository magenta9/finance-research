import { spawn } from 'node:child_process';
import path from 'node:path';

import type { FuturesTrendObservationRequest, StrategyCliService } from './types';

export interface StrategyCliProcessRequest {
  args: string[];
  command: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
}

export interface StrategyCliProcessResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
  stdout: string;
}

export type StrategyCliRunner = (request: StrategyCliProcessRequest) => Promise<StrategyCliProcessResult>;

export interface FuturesTrendObservationServiceOptions {
  projectRoot: string;
  pythonCommand: string;
  quantDataArgs?: string[];
  quantDataCommand?: string;
  quantDataCwd?: string;
  runner?: StrategyCliRunner;
  timeoutMs?: number;
}

const defaultTimeoutMs = 45_000;

const defaultRunner: StrategyCliRunner = async ({ args, command, cwd, env, timeoutMs }) => await new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let settled = false;

  const timeout = setTimeout(() => {
    settled = true;
    child.kill('SIGTERM');
    reject(new Error(`strategy CLI timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });
  child.on('error', (error) => {
    if (settled) {
      return;
    }
    settled = true;
    clearTimeout(timeout);
    reject(new Error(`Failed to start strategy CLI: ${error.message}`));
  });
  child.on('close', (exitCode, signal) => {
    if (settled) {
      return;
    }
    settled = true;
    clearTimeout(timeout);
    resolve({ exitCode, signal, stderr, stdout });
  });
});

const parseStrategyJson = (stdout: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(stdout.trim()) as unknown;

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('strategy output was not a JSON object');
    }

    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(`strategy CLI returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
};

export const normalizeFuturesTrendSymbol = (symbol: string) => {
  const normalized = symbol.trim().toUpperCase();

  if (!normalized || /\d/.test(normalized)) {
    return normalized;
  }

  return `${normalized}9999`;
};

export const createFuturesTrendObservationService = ({
  projectRoot,
  pythonCommand,
  quantDataArgs,
  quantDataCommand,
  quantDataCwd,
  runner = defaultRunner,
  timeoutMs = defaultTimeoutMs,
}: FuturesTrendObservationServiceOptions): StrategyCliService => ({
  async analyzeFuturesTrendObservation(request: FuturesTrendObservationRequest) {
    const symbol = normalizeFuturesTrendSymbol(request.symbol);
    const args = [
      path.join(projectRoot, 'tools', 'strategy', 'futures-trend-observation', 'analyze.py'),
      '--symbol',
      symbol,
      '--market',
      request.market,
    ];

    if (request.end) {
      args.push('--end', request.end);
    }
    if (request.lookbackDays !== undefined) {
      args.push('--lookback-days', String(request.lookbackDays));
    }
    if (quantDataCommand) {
      args.push('--quant-data', quantDataCommand);
    }
    for (const quantDataArg of quantDataArgs ?? []) {
      args.push('--quant-data-arg', quantDataArg);
    }
    if (quantDataCwd) {
      args.push('--quant-data-cwd', quantDataCwd);
    }

    const result = await runner({
      args,
      command: pythonCommand,
      cwd: projectRoot,
      timeoutMs,
    });

    if (result.exitCode !== 0) {
      const detail = result.stderr.trim() || result.stdout.trim() || result.signal || 'no output';
      throw new Error(`strategy CLI exited with ${result.exitCode ?? result.signal ?? 'unknown'}: ${detail}`);
    }

    return parseStrategyJson(result.stdout);
  },
});