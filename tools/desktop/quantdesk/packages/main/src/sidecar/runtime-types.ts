export type SidecarRuntimeState = 'idle' | 'starting' | 'ready' | 'degraded' | 'restarting' | 'stopped';

export interface SidecarDiagnostic {
    level: 'info' | 'warn' | 'error' | 'fatal';
    message: string;
    raw: string;
    source: 'stderr';
    timestamp: string;
}

export interface SidecarFault {
    kind: 'startup' | 'transport' | 'process-exit' | 'diagnostic' | 'rpc';
    message: string;
    timestamp: string;
}

export interface SidecarSnapshot {
    state: SidecarRuntimeState;
    pid: number | null;
    endpoint: string | null;
    healthy: boolean;
    restartCount: number;
    lastError: SidecarFault | null;
    lastDiagnostic: SidecarDiagnostic | null;
}

export interface SidecarRpc {
    call<T>(method: string, params?: unknown, options?: { timeoutMs?: number }): Promise<T>;
}