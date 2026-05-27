export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export type LogSource = 'main' | 'renderer' | 'preload' | 'sidecar';

export interface LogEntry {
    ts: string;
    pid: number;
    level: LogLevel;
    source: LogSource;
    message: string;
    error?: string;
    stack?: string;
    context?: unknown;
}

export type LogWriteInput = Omit<LogEntry, 'ts' | 'pid'>;