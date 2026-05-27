import type { LogEntry, LogLevel, LogWriteInput } from '@quantdesk/shared';

interface RendererLoggerOptions {
    flushIntervalMs?: number;
    maxBatchSize?: number;
    source?: LogEntry['source'];
}

const MAX_SERIALIZE_DEPTH = 5;
const MAX_SERIALIZE_ITEMS = 50;

export class RendererLogger {
    private readonly source: LogEntry['source'];

    private readonly queue: LogWriteInput[] = [];

    private flushTimer: number | null = null;

    private readonly flushIntervalMs: number;

    private readonly maxBatchSize: number;

    constructor(options: RendererLoggerOptions = {}) {
        this.flushIntervalMs = options.flushIntervalMs ?? 300;
        this.maxBatchSize = options.maxBatchSize ?? 20;
        this.source = options.source ?? 'renderer';
    }

    info(message: string, context?: Record<string, unknown>): void {
        this.send('info', message, undefined, context);
    }

    warn(message: string, context?: Record<string, unknown>): void {
        this.send('warn', message, undefined, context);
    }

    error(message: string, error?: Error, context?: Record<string, unknown>): void {
        this.send('error', message, error, context);
    }

    fatal(message: string, error?: Error, context?: Record<string, unknown>): void {
        this.send('fatal', message, error, context);
    }

    flush(): void {
        if (this.flushTimer !== null) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }

        const batch = this.queue.splice(0, this.queue.length);

        if (batch.length === 0) {
            return;
        }

        try {
            window.api?.log?.writeBatch(batch);
        } catch (error) {
            console.warn('[renderer] Failed to flush renderer logs over IPC; keeping console output only.', {
                batchSize: batch.length,
                error: error instanceof Error ? error.message : String(error),
            });
        }
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

    private send(
        level: LogLevel,
        message: string,
        error?: Error,
        context?: Record<string, unknown>,
    ): void {
        const consoleFn = level === 'error' || level === 'fatal'
            ? console.error
            : level === 'warn'
                ? console.warn
                : console.info;

        consoleFn(`[${this.source}] ${message}`, error ?? '', context ?? '');

        this.queue.push({
            context: this.safeSerialize(context),
            error: error?.message,
            level,
            message,
            source: this.source,
            stack: error?.stack,
        });

        if (this.queue.length >= this.maxBatchSize) {
            this.flush();
            return;
        }

        if (this.flushTimer === null) {
            this.flushTimer = window.setTimeout(() => this.flush(), this.flushIntervalMs);
        }
    }
}

export const logger = new RendererLogger();