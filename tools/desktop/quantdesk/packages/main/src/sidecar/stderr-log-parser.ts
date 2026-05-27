import type { LoggerLike } from '../logger';
import type { SidecarDiagnostic } from './runtime-types';

export interface StderrParseResult {
    lastDiagnostic: SidecarDiagnostic | null;
    lastError: string | null;
}

export const parseStderrLines = (
    lines: string[],
    logger?: LoggerLike,
): StderrParseResult => {
    let lastDiagnostic: SidecarDiagnostic | null = null;
    let lastError: string | null = null;

    for (const rawLine of lines) {
        const trimmed = rawLine.trim();

        if (!trimmed) {
            continue;
        }

        if (!trimmed.startsWith('{')) {
            lastError = trimmed;
            lastDiagnostic = {
                level: 'warn',
                message: trimmed,
                raw: trimmed,
                source: 'stderr',
                timestamp: new Date().toISOString(),
            };
            logger?.warn('sidecar', trimmed);
            continue;
        }

        try {
            const parsed = JSON.parse(trimmed) as Record<string, unknown>;
            const level = normalizeLogLevel(parsed.level);
            const message = typeof parsed.message === 'string' ? parsed.message : trimmed;
            const detail = typeof parsed.detail === 'string' ? parsed.detail : undefined;
            const stack = typeof parsed.stack === 'string'
                ? parsed.stack
                : Array.isArray(parsed.traceback)
                    ? parsed.traceback.map((entry) => String(entry)).join('')
                    : undefined;

            if (level === 'warn' || level === 'error' || level === 'fatal') {
                lastError = trimmed;
            }

            lastDiagnostic = {
                level,
                message,
                raw: trimmed,
                source: 'stderr',
                timestamp: new Date().toISOString(),
            };

            logger?.write({
                context: parsed,
                error: detail,
                level,
                message,
                source: 'sidecar',
                stack,
            });
        } catch (error) {
            lastError = trimmed;
            lastDiagnostic = {
                level: 'warn',
                message: trimmed,
                raw: trimmed,
                source: 'stderr',
                timestamp: new Date().toISOString(),
            };
            logger?.warn('sidecar', 'Malformed sidecar stderr JSON.', {
                error: error instanceof Error ? error.message : String(error),
                rawLine: trimmed.slice(0, 200),
            });
        }
    }

    return { lastDiagnostic, lastError };
};

export const normalizeLogLevel = (value: unknown): SidecarDiagnostic['level'] => {
    switch (value) {
        case 'info':
        case 'warn':
        case 'error':
        case 'fatal':
            return value;
        case 'debug':
            return 'info';
        default:
            return 'info';
    }
};