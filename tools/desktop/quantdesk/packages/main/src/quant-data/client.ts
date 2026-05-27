import { spawn } from 'node:child_process';

export type QuantDataMethod =
    | 'get-fx-rates'
    | 'get-price-series'
    | 'read-prices'
    | 'search-assets'
    | 'status';

export interface QuantDataEnvelope<T> {
    ok: boolean;
    data?: T;
    dataQualityStatus?: 'available' | 'degraded' | 'partial' | 'unavailable' | string;
    maintenanceError?: { code?: string; message?: string } | null;
    maintenanceStatus?: Record<string, unknown> | null;
    providerStatus?: Record<string, unknown> | null;
    resultProvenance?: Record<string, unknown> | null;
}

export interface QuantDataProcessRequest {
    args: string[];
    command: string;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    input?: string;
    timeoutMs: number;
}

export interface QuantDataProcessResult {
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    stderr: string;
    stdout: string;
}

export type QuantDataRunner = (request: QuantDataProcessRequest) => Promise<QuantDataProcessResult>;

export interface QuantDataCliClientOptions {
    args?: string[];
    command?: string;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    runner?: QuantDataRunner;
    timeoutMs?: number;
}

export class QuantDataCliError extends Error {
    readonly code: 'command_failed' | 'invalid_json' | 'process_failed' | 'timeout';

    readonly details?: unknown;

    constructor(code: QuantDataCliError['code'], message: string, details?: unknown) {
        super(message);
        this.name = 'QuantDataCliError';
        this.code = code;
        this.details = details;
    }
}

const DEFAULT_TIMEOUT_MS = 30_000;

const parseExtraArgs = (raw?: string) => (
    raw?.split(' ').map((part) => part.trim()).filter((part) => part.length > 0) ?? []
);

const defaultRunner: QuantDataRunner = async ({ args, command, cwd, env, input, timeoutMs }) => await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
        cwd,
        env: { ...process.env, ...env },
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timeout = setTimeout(() => {
        settled = true;
        child.kill('SIGTERM');
        reject(new QuantDataCliError('timeout', `quant-data timed out after ${timeoutMs}ms`, { args, command }));
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
        reject(new QuantDataCliError('process_failed', `Failed to start quant-data: ${error.message}`, { args, command }));
    });
    child.on('close', (exitCode, signal) => {
        if (settled) {
            return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve({ exitCode, signal, stderr, stdout });
    });

    if (input !== undefined) {
        child.stdin.end(input);
        return;
    }

    child.stdin.end();
});

const parseEnvelope = <T>(stdout: string, method: QuantDataMethod): QuantDataEnvelope<T> => {
    try {
        const parsed = JSON.parse(stdout.trim()) as unknown;
        if (typeof parsed !== 'object' || parsed === null || !('ok' in parsed)) {
            throw new Error('stdout did not contain a quant-data envelope');
        }
        return parsed as QuantDataEnvelope<T>;
    } catch (error) {
        throw new QuantDataCliError(
            'invalid_json',
            `quant-data ${method} returned invalid JSON`,
            { cause: error instanceof Error ? error.message : String(error), stdout },
        );
    }
};

const parseJson = <T>(stdout: string, label: string): T => {
    try {
        return JSON.parse(stdout.trim()) as T;
    } catch (error) {
        throw new QuantDataCliError(
            'invalid_json',
            `quant-data ${label} returned invalid JSON`,
            { cause: error instanceof Error ? error.message : String(error), stdout },
        );
    }
};

export class QuantDataCliClient {
    private readonly args: string[];

    private readonly command: string;

    private readonly cwd?: string;

    private readonly env?: NodeJS.ProcessEnv;

    private readonly runner: QuantDataRunner;

    private readonly timeoutMs: number;

    constructor(options: QuantDataCliClientOptions = {}) {
        this.command = options.command ?? process.env.QUANT_DATA_CLI ?? 'quant-data';
        this.args = options.args ?? parseExtraArgs(process.env.QUANT_DATA_CLI_ARGS);
        this.cwd = options.cwd;
        this.env = options.env;
        this.runner = options.runner ?? defaultRunner;
        this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    }

    async run<T>(method: QuantDataMethod, payload?: Record<string, unknown>): Promise<QuantDataEnvelope<T>> {
        const result = await this.runner({
            args: [...this.args, method],
            command: this.command,
            cwd: this.cwd,
            env: this.env,
            input: payload === undefined ? undefined : `${JSON.stringify(payload)}\n`,
            timeoutMs: this.timeoutMs,
        });

        if (result.exitCode !== 0) {
            throw new QuantDataCliError('process_failed', `quant-data ${method} exited with code ${result.exitCode ?? result.signal ?? 'unknown'}`, {
                stderr: result.stderr,
                stdout: result.stdout,
            });
        }

        const envelope = parseEnvelope<T>(result.stdout, method);
        if (!envelope.ok) {
            const message = envelope.maintenanceError?.message ?? `quant-data ${method} returned ok=false`;
            throw new QuantDataCliError('command_failed', message, envelope);
        }

        return envelope;
    }

    async helpJson<T>(): Promise<T> {
        const result = await this.runner({
            args: [...this.args, 'help', '--json'],
            command: this.command,
            cwd: this.cwd,
            env: this.env,
            input: undefined,
            timeoutMs: this.timeoutMs,
        });

        if (result.exitCode !== 0) {
            throw new QuantDataCliError('process_failed', `quant-data help --json exited with code ${result.exitCode ?? result.signal ?? 'unknown'}`, {
                stderr: result.stderr,
                stdout: result.stdout,
            });
        }

        return parseJson<T>(result.stdout, 'help --json');
    }
}
