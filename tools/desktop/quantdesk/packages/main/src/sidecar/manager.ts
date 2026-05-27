import {
    spawn,
    type ChildProcessByStdio,
} from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';

import type { LoggerLike } from '../logger';
import { RpcClient } from './rpc-client';
import { parseStderrLines } from './stderr-log-parser';
import type { SidecarDiagnostic, SidecarFault, SidecarRuntimeState } from './runtime-types';

export interface SidecarManagerOptions {
    extraNoProxyDomains?: string[];
    logger?: LoggerLike;
    pythonCommand?: string;
    resolveScriptPath: () => string;
    maxRestartAttempts?: number;
}

const sidecarDotEnvAllowlist = new Set(['TUSHARE_TOKEN']);

interface ReadyMessage {
    ready: boolean;
    port: number;
}

export const createSidecarProcessEnv = ({
    baseEnv,
    dotEnvPaths = [path.resolve(process.cwd(), '.env')],
    extraNoProxyDomains = [],
}: {
    baseEnv: NodeJS.ProcessEnv;
    dotEnvPaths?: string[];
    extraNoProxyDomains?: string[];
}) => {
    const dotEnv = loadDotEnvFiles(dotEnvPaths);
    const parentNoProxy = baseEnv.no_proxy ?? baseEnv.NO_PROXY ?? '';
    const noProxy = [parentNoProxy, ...extraNoProxyDomains].filter(Boolean).join(',');

    return {
        ...dotEnv,
        ...baseEnv,
        PYTHONDONTWRITEBYTECODE: '1',
        PYTHONUNBUFFERED: '1',
        no_proxy: noProxy,
        NO_PROXY: noProxy,
    };
};

const loadDotEnvFiles = (filePaths: string[]): NodeJS.ProcessEnv => {
    const env: NodeJS.ProcessEnv = {};

    for (const filePath of Array.from(new Set(filePaths))) {
        Object.assign(env, loadDotEnvFile(filePath));
    }

    return env;
};

const loadDotEnvFile = (filePath: string): NodeJS.ProcessEnv => {
    if (!existsSync(filePath)) {
        return {};
    }

    const env: NodeJS.ProcessEnv = {};

    for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/u)) {
        const trimmed = line.trim();

        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }

        const separatorIndex = trimmed.indexOf('=');
        if (separatorIndex <= 0) {
            continue;
        }

        const key = trimmed.slice(0, separatorIndex).trim();
        const rawValue = trimmed.slice(separatorIndex + 1).trim();
        const value = rawValue.replace(/^['"]|['"]$/gu, '');

        if (sidecarDotEnvAllowlist.has(key)) {
            env[key] = value;
        }
    }

    return env;
};

export interface SidecarRuntimeStatus {
    sidecarReady: boolean;
    sidecarPid: number | null;
    sidecarPort: number | null;
    lastError: string | null;
    endpoint: string | null;
    lastDiagnostic: SidecarDiagnostic | null;
    lastFault: SidecarFault | null;
    restartCount: number;
    state: SidecarRuntimeState;
}

export class SidecarManager {
    private child: ChildProcessByStdio<null, Readable, Readable> | null = null;

    private readonly options: SidecarManagerOptions;

    private readonly rpcClient: RpcClient;

    private readonly pythonCommand: string;

    private readonly maxRestartAttempts: number;

    private readyPromise: Promise<void> | null = null;

    private restartAttempts = 0;

    private shuttingDown = false;

    private port: number | null = null;

    private lastError: string | null = null;

    private lastDiagnostic: SidecarDiagnostic | null = null;

    private lastFault: SidecarFault | null = null;

    private state: SidecarRuntimeState = 'idle';

    private stderrBuffer = '';

    constructor(options: SidecarManagerOptions) {
        this.options = options;
        this.pythonCommand = options.pythonCommand ?? 'python3';
        this.maxRestartAttempts = options.maxRestartAttempts ?? 3;
        this.rpcClient = new RpcClient(() => {
            this.handleConnectionClosed();
        }, options.logger);
    }

    getStatus(): SidecarRuntimeStatus {
        return {
            endpoint: this.port != null ? `ws://127.0.0.1:${this.port}` : null,
            lastDiagnostic: this.lastDiagnostic,
            lastFault: this.lastFault,
            sidecarReady: this.rpcClient.isConnected(),
            sidecarPid: this.child?.pid ?? null,
            sidecarPort: this.port,
            lastError: this.lastError,
            restartCount: this.restartAttempts,
            state: this.state,
        };
    }

    async start() {
        if (this.readyPromise) {
            return await this.readyPromise;
        }

        this.state = this.restartAttempts > 0 ? 'restarting' : 'starting';

        this.readyPromise = this.spawnProcess();

        try {
            await this.readyPromise;
            this.restartAttempts = 0;
        } finally {
            this.readyPromise = null;
        }
    }

    async ensureReady() {
        if (this.rpcClient.isConnected()) {
            this.state = 'ready';
            return;
        }

        await this.start();
    }

    async call<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T> {
        await this.ensureReady();
        return await this.rpcClient.call<T>(method, params, timeoutMs);
    }

    async stop() {
        this.shuttingDown = true;
        this.state = 'stopped';

        try {
            if (this.rpcClient.isConnected()) {
                this.rpcClient.notify('shutdown');
            }
        } catch (error) {
            this.options.logger?.warn('main', 'Failed to notify sidecar about shutdown during teardown.', {
                error: error instanceof Error ? error.message : String(error),
            });
        }

        await this.rpcClient.close();

        if (!this.child) {
            return;
        }

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
    }

    recordError(error: unknown) {
        this.lastError = error instanceof Error ? error.message : String(error);
        this.lastFault = {
            kind: 'rpc',
            message: this.lastError,
            timestamp: new Date().toISOString(),
        };
        this.state = this.child ? 'degraded' : 'stopped';
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        this.options.logger?.error('main', 'Sidecar manager error', normalizedError);
    }

    private handleConnectionClosed() {
        if (this.shuttingDown) {
            return;
        }

        this.recordError(new Error('JSON-RPC websocket closed.'));
        this.lastFault = {
            kind: 'transport',
            message: 'JSON-RPC websocket closed.',
            timestamp: new Date().toISOString(),
        };
        this.state = 'degraded';

        if (this.child && this.child.exitCode == null) {
            this.child.kill('SIGKILL');
        }
    }

    private async spawnProcess() {
        const scriptPath = this.options.resolveScriptPath();
        const cwd = path.dirname(scriptPath);

        await new Promise<void>((resolve, reject) => {
            const child = spawn(this.pythonCommand, [scriptPath], {
                cwd,
                env: createSidecarProcessEnv({
                    baseEnv: process.env,
                    dotEnvPaths: [
                        path.resolve(process.cwd(), '.env'),
                        path.resolve(cwd, '../..', '.env'),
                    ],
                    extraNoProxyDomains: this.options.extraNoProxyDomains,
                }),
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            this.child = child;
            let stdoutBuffer = '';

            const cleanupAll = () => {
                child.stdout.off('data', handleStdout);
                child.stderr.off('data', handleStderr);
                child.off('error', handleError);
                child.off('exit', handleExit);
            };

            const cleanupReadyListener = () => {
                child.stdout.off('data', handleStdout);
            };

            const resolveReady = async (message: ReadyMessage) => {
                cleanupReadyListener();
                this.port = message.port;

                try {
                    await this.rpcClient.connect(`ws://127.0.0.1:${message.port}`);
                    await this.rpcClient.call('health_check', undefined, 5_000);
                    this.state = 'ready';
                    resolve();
                } catch (error) {
                    this.lastError = error instanceof Error ? error.message : String(error);
                    this.lastFault = {
                        kind: 'startup',
                        message: this.lastError,
                        timestamp: new Date().toISOString(),
                    };
                    this.state = 'degraded';
                    reject(error);
                }
            };

            const handleStdout = (chunk: Buffer) => {
                stdoutBuffer += chunk.toString();
                const lines = stdoutBuffer.split('\n');
                stdoutBuffer = lines.pop() ?? '';

                for (const line of lines) {
                    const trimmed = line.trim();

                    if (!trimmed) {
                        continue;
                    }

                    try {
                        const message = JSON.parse(trimmed) as ReadyMessage;

                        if (message.ready && typeof message.port === 'number') {
                            void resolveReady(message);
                        }
                    } catch (error) {
                        if (trimmed.startsWith('{')) {
                            this.options.logger?.warn('main', 'Ignored malformed sidecar readiness payload.', {
                                error: error instanceof Error ? error.message : String(error),
                                rawLine: trimmed.slice(0, 200),
                            });
                        }
                    }
                }
            };

            const handleStderr = (chunk: Buffer) => {
                this.stderrBuffer += chunk.toString('utf8');
                this.drainStderrBuffer();
            };

            const handleError = (error: Error) => {
                cleanupAll();
                this.recordError(error);
                this.lastFault = {
                    kind: 'startup',
                    message: error.message,
                    timestamp: new Date().toISOString(),
                };
                this.state = 'degraded';
                reject(error);
            };

            const handleExit = (code: number | null, signal: NodeJS.Signals | null) => {
                this.port = null;
                this.child = null;
                cleanupAll();
                this.drainStderrBuffer(true);

                if (this.shuttingDown) {
                    return;
                }

                this.lastError = `Sidecar exited with code ${code ?? 'null'} signal ${signal ?? 'null'}.`;
                this.lastFault = {
                    kind: 'process-exit',
                    message: this.lastError,
                    timestamp: new Date().toISOString(),
                };

                if (this.restartAttempts >= this.maxRestartAttempts) {
                    this.state = 'degraded';
                    return;
                }

                this.restartAttempts += 1;
                this.state = 'restarting';
                const delay = 250 * 2 ** (this.restartAttempts - 1);

                setTimeout(() => {
                    void this.start().catch((error) => this.recordError(error));
                }, delay);
            };

            child.stdout.on('data', handleStdout);
            child.stderr.on('data', handleStderr);
            child.on('error', handleError);
            child.on('exit', handleExit);
        });
    }

    private drainStderrBuffer(flushRemainder = false) {
        const lines = this.stderrBuffer.split('\n');

        if (!flushRemainder) {
            this.stderrBuffer = lines.pop() ?? '';
        } else {
            this.stderrBuffer = '';
        }

        const result = parseStderrLines(lines, this.options.logger);

        if (result.lastDiagnostic) {
            this.lastDiagnostic = result.lastDiagnostic;
        }

        if (result.lastError) {
            this.lastError = result.lastError;
            this.lastFault = {
                kind: 'diagnostic',
                message: result.lastError,
                timestamp: new Date().toISOString(),
            };
            if (!this.rpcClient.isConnected()) {
                this.state = this.child ? 'degraded' : this.state;
            }
        }
    }
}
