import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import type { LogEntry, LogLevel, LogWriteInput } from '@quantdesk/shared';

const DEFAULT_MAX_FILE_SIZE = 5 * 1024 * 1024;
const DEFAULT_MAX_FILES = 5;
const MAX_SERIALIZE_DEPTH = 5;
const MAX_SERIALIZE_ITEMS = 50;

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    fatal: 4,
};

export interface LoggerOptions {
    logDir: string | null;
    maxFileSize?: number;
    maxFiles?: number;
    minLevel?: LogLevel;
    writeToStderr?: boolean;
}

export interface LoggerLike {
    write: (entry: LogWriteInput | LogEntry) => void;
    info: (source: LogEntry['source'], message: string, context?: unknown) => void;
    warn: (source: LogEntry['source'], message: string, context?: unknown) => void;
    error: (
        source: LogEntry['source'],
        message: string,
        error?: Error,
        context?: unknown,
    ) => void;
    fatal: (
        source: LogEntry['source'],
        message: string,
        error?: Error,
        context?: unknown,
    ) => void;
    getLogDirectory: () => string | null;
    close: () => Promise<void>;
}

export class Logger implements LoggerLike {
    private stream: fs.WriteStream | null = null;

    private currentFileSize = 0;

    private readonly logDir: string | null;

    private readonly maxFileSize: number;

    private readonly maxFiles: number;

    private readonly minLevel: LogLevel;

    private readonly writeToStderr: boolean;

    private readonly pendingLines: string[] = [];

    private lastInternalError: string | null = null;

    private flushPromise: Promise<void> | null = null;

    private stderrOnly = false;

    private stderrUnavailable = false;

    private readonly handleProcessStderrClose = () => {
        this.handleStderrFailure(new Error('stderr stream closed'), 'stderr stream close');
    };

    private readonly handleProcessStderrError = (error: Error) => {
        this.handleStderrFailure(error, 'stderr stream error');
    };

    constructor(options: LoggerOptions) {
        this.logDir = options.logDir;
        this.maxFileSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
        this.maxFiles = Math.max(1, options.maxFiles ?? DEFAULT_MAX_FILES);
        this.minLevel = options.minLevel ?? 'info';
        this.writeToStderr = options.writeToStderr ?? true;

        if (this.writeToStderr) {
            process.stderr.on('close', this.handleProcessStderrClose);
            process.stderr.on('error', this.handleProcessStderrError);
        }

        if (!this.logDir) {
            this.stderrOnly = true;
            return;
        }

        try {
            fs.mkdirSync(this.logDir, { recursive: true });
            const existingSize = fs.existsSync(this.getCurrentLogPath())
                ? fs.statSync(this.getCurrentLogPath()).size
                : 0;

            this.currentFileSize = existingSize;
        } catch (error) {
            this.handleFileError(error, 'initialize log directory');
        }
    }

    write(entry: LogWriteInput | LogEntry): void {
        if (LOG_LEVEL_PRIORITY[entry.level] < LOG_LEVEL_PRIORITY[this.minLevel]) {
            return;
        }

        const normalized = this.normalizeEntry(entry);
        const line = `${JSON.stringify(normalized)}\n`;

        if (this.writeToStderr) {
            this.writeLineToStderr(line);
        }

        this.pendingLines.push(line);
        void this.flush();
    }

    info(source: LogEntry['source'], message: string, context?: unknown): void {
        this.write({ level: 'info', source, message, context });
    }

    warn(source: LogEntry['source'], message: string, context?: unknown): void {
        this.write({ level: 'warn', source, message, context });
    }

    error(
        source: LogEntry['source'],
        message: string,
        error?: Error,
        context?: unknown,
    ): void {
        this.write({
            level: 'error',
            source,
            message,
            error: error?.message,
            stack: error?.stack,
            context,
        });
    }

    fatal(
        source: LogEntry['source'],
        message: string,
        error?: Error,
        context?: unknown,
    ): void {
        this.write({
            level: 'fatal',
            source,
            message,
            error: error?.message,
            stack: error?.stack,
            context,
        });
    }

    getLogDirectory(): string | null {
        return this.logDir;
    }

    async close(): Promise<void> {
        await this.flush();
        await this.closeStream();

        if (this.writeToStderr) {
            process.stderr.off('close', this.handleProcessStderrClose);
            process.stderr.off('error', this.handleProcessStderrError);
        }
    }

    private normalizeEntry(entry: LogWriteInput | LogEntry): LogEntry {
        return {
            ...entry,
            context: this.safeSerialize(entry.context),
            pid: 'pid' in entry ? entry.pid : process.pid,
            ts: 'ts' in entry ? entry.ts : new Date().toISOString(),
        };
    }

    private safeSerialize(
        value: unknown,
        seen = new WeakSet<object>(),
        depth = 0,
    ): unknown {
        if (value == null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
            return value;
        }

        if (typeof value === 'bigint') {
            return value.toString();
        }

        if (typeof value === 'function') {
            return `[Function ${value.name || 'anonymous'}]`;
        }

        if (value instanceof Date) {
            return value.toISOString();
        }

        if (value instanceof RegExp) {
            return value.toString();
        }

        if (value instanceof Error) {
            return {
                cause: this.safeSerialize(value.cause, seen, depth + 1),
                message: value.message,
                name: value.name,
                stack: value.stack,
            };
        }

        if (depth >= MAX_SERIALIZE_DEPTH) {
            return '[MaxDepthExceeded]';
        }

        if (typeof value !== 'object') {
            return String(value);
        }

        if (seen.has(value)) {
            return '[Circular]';
        }

        seen.add(value);

        if (Array.isArray(value)) {
            const serialized = value
                .slice(0, MAX_SERIALIZE_ITEMS)
                .map((item) => this.safeSerialize(item, seen, depth + 1));

            seen.delete(value);
            return serialized;
        }

        const serializedObject: Record<string, unknown> = {};

        for (const [key, item] of Object.entries(value).slice(0, MAX_SERIALIZE_ITEMS)) {
            serializedObject[key] = this.safeSerialize(item, seen, depth + 1);
        }

        seen.delete(value);
        return serializedObject;
    }

    private flush(): Promise<void> {
        if (this.flushPromise) {
            return this.flushPromise;
        }

        this.flushPromise = this.flushPending().finally(() => {
            this.flushPromise = null;

            if (this.pendingLines.length > 0) {
                void this.flush();
            }
        });

        return this.flushPromise;
    }

    private async flushPending(): Promise<void> {
        while (this.pendingLines.length > 0) {
            const line = this.pendingLines.shift();

            if (!line) {
                continue;
            }

            if (this.stderrOnly || !this.logDir) {
                continue;
            }

            this.ensureStream();

            if (this.stderrOnly || !this.stream) {
                continue;
            }

            const lineSize = Buffer.byteLength(line);

            if (this.currentFileSize > 0 && this.currentFileSize + lineSize > this.maxFileSize) {
                await this.rotate();

                if (this.stderrOnly || !this.stream) {
                    continue;
                }
            }

            try {
                await new Promise<void>((resolve, reject) => {
                    this.stream?.write(line, (error) => {
                        if (error) {
                            reject(error);
                            return;
                        }

                        resolve();
                    });
                });
                this.currentFileSize += lineSize;
            } catch (error) {
                this.handleFileError(error, 'write log line');
            }
        }
    }

    private async rotate(): Promise<void> {
        if (this.stderrOnly || !this.logDir) {
            return;
        }

        try {
            await this.closeStream();

            const oldestPath = path.join(this.logDir, `quantdesk.${this.maxFiles - 1}.log`);
            await fsp.rm(oldestPath, { force: true });

            for (let index = this.maxFiles - 2; index >= 1; index -= 1) {
                const sourcePath = path.join(this.logDir, `quantdesk.${index}.log`);
                const targetPath = path.join(this.logDir, `quantdesk.${index + 1}.log`);

                if (!fs.existsSync(sourcePath)) {
                    continue;
                }

                await fsp.rename(sourcePath, targetPath);
            }

            const currentPath = this.getCurrentLogPath();
            const rotatedPath = path.join(this.logDir, 'quantdesk.1.log');

            if (fs.existsSync(currentPath)) {
                await fsp.rename(currentPath, rotatedPath);
            }

            this.currentFileSize = 0;
            this.ensureStream();
        } catch (error) {
            this.handleFileError(error, 'rotate log files');
        }
    }

    private ensureStream(): void {
        if (this.stderrOnly || !this.logDir || this.stream) {
            return;
        }

        try {
            const stream = fs.createWriteStream(this.getCurrentLogPath(), { flags: 'a' });
            stream.on('error', () => {
                this.handleFileError(new Error('write stream emitted an error event.'), 'listen for stream errors');
            });
            this.stream = stream;
        } catch (error) {
            this.handleFileError(error, 'open log stream');
        }
    }

    private getCurrentLogPath(): string {
        if (!this.logDir) {
            throw new Error('Log directory is not configured.');
        }

        return path.join(this.logDir, 'quantdesk.log');
    }

    private async closeStream(): Promise<void> {
        if (!this.stream) {
            return;
        }

        const stream = this.stream;
        this.stream = null;

        await new Promise<void>((resolve) => {
            stream.end(() => resolve());
        });
    }

    private handleFileError(error: unknown, action: string): void {
        this.lastInternalError = `${action}: ${error instanceof Error ? error.message : String(error)}`;
        this.stderrOnly = true;

        if (this.stream) {
            this.stream.destroy();
            this.stream = null;
        }
    }

    private handleStderrFailure(error: unknown, action: string): void {
        this.lastInternalError = `${action}: ${error instanceof Error ? error.message : String(error)}`;
        this.stderrUnavailable = true;
    }

    private shouldWriteToStderr(): boolean {
        return this.writeToStderr
            && !this.stderrUnavailable
            && !process.stderr.destroyed
            && process.stderr.writable;
    }

    private writeLineToStderr(line: string): void {
        if (!this.shouldWriteToStderr()) {
            return;
        }

        try {
            process.stderr.write(line, (error) => {
                if (error) {
                    this.handleStderrFailure(error, 'write stderr line');
                }
            });
        } catch (error) {
            this.handleStderrFailure(error, 'write stderr line');
        }
    }
}