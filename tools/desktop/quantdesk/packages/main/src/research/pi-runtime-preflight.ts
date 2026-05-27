import type { PiResearchRuntime } from './pi-executor';

export const piRuntimeReadyTimeoutMs = 30_000;

const runtimeDiagnosticRedactions: Array<[RegExp, string]> = [
    [/(authorization:\s*)[^\r\n,;]+/gi, '$1[redacted]'],
    [/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[redacted]'],
    [/(x-api-key:\s*)[^\r\n,;]+/gi, '$1[redacted]'],
    [/("(?:api[_-]?key|token|secret|password)"\s*:\s*")[^"]+(")/gi, '$1[redacted]$2'],
    [/(\b(?:api[_-]?key|token|secret|password)\s*:\s*)[^\s,;}]+/gi, '$1[redacted]'],
    [/((?:api[_-]?key|token|secret|password)=)[^&\s]+/gi, '$1[redacted]'],
    [/(cookie:\s*)[^\r\n]+/gi, '$1[redacted]'],
];

export const redactRuntimeDiagnostic = (value: string | null | undefined, fallback: string) => {
    const raw = value?.trim() || fallback;
    const redacted = runtimeDiagnosticRedactions.reduce(
        (current, [pattern, replacement]) => current.replace(pattern, replacement),
        raw,
    );

    return redacted.length > 300 ? `${redacted.slice(0, 300)}... [truncated]` : redacted;
};

export const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> => {
    let timeout: NodeJS.Timeout | null = null;

    try {
        return await Promise.race([
            promise,
            new Promise<never>((_, reject) => {
                timeout = setTimeout(() => {
                    reject(new Error(timeoutMessage));
                }, timeoutMs);
            }),
        ]);
    } finally {
        if (timeout) {
            clearTimeout(timeout);
        }
    }
};

export const createPiRuntimeDegradationReason = async (piRuntime: PiResearchRuntime | undefined) => {
    if (!piRuntime) {
        return 'Pi runtime is unavailable.';
    }

    try {
        await withTimeout(
            piRuntime.ensureReady(),
            piRuntimeReadyTimeoutMs,
            `Pi runtime startup timed out after ${piRuntimeReadyTimeoutMs}ms`,
        );
        const status = await piRuntime.getStatus?.();

        if (!status) {
            return null;
        }

        if (status.state === 'error') {
            return `Pi runtime is not ready for research: ${redactRuntimeDiagnostic(status.lastError ?? status.degradedReason, 'runtime error')}.`;
        }

        if (status.state !== 'ready' && status.state !== 'degraded') {
            return `Pi runtime is ${status.state}.`;
        }

        if (!status.model.available) {
            return 'Pi runtime is not ready for research: no model is available.';
        }

        if (!status.financeTools.available) {
            return `Pi runtime is not ready for research: finance tools unavailable${status.financeTools.lastError ? ` (${redactRuntimeDiagnostic(status.financeTools.lastError, 'tool host error')})` : ''}.`;
        }
    } catch (error) {
        return `Pi runtime status check failed: ${redactRuntimeDiagnostic(error instanceof Error ? error.message : String(error), 'status check error')}.`;
    }

    return null;
};