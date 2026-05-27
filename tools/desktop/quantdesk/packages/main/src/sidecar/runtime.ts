import type { SidecarManager } from './manager';
import type { SidecarRpc, SidecarSnapshot } from './runtime-types';

export class SidecarRuntime implements SidecarRpc {
    private readonly manager: Pick<SidecarManager, 'call' | 'ensureReady' | 'getStatus' | 'stop'>;

    constructor(manager: Pick<SidecarManager, 'call' | 'ensureReady' | 'getStatus' | 'stop'>) {
        this.manager = manager;
    }

    async ensureReady(): Promise<void> {
        await this.manager.ensureReady();
    }

    async call<T>(method: string, params?: unknown, options?: { timeoutMs?: number }): Promise<T> {
        await this.ensureReady();
        return await this.manager.call<T>(method, params, options?.timeoutMs);
    }

    snapshot(): SidecarSnapshot {
        const status = this.manager.getStatus();

        return {
            endpoint: status.endpoint,
            healthy: status.sidecarReady,
            lastDiagnostic: status.lastDiagnostic,
            lastError: status.lastFault,
            pid: status.sidecarPid,
            restartCount: status.restartCount,
            state: status.state,
        };
    }

    async stop(_reason: 'shutdown' | 'restart' | 'dispose' = 'shutdown') {
        await this.manager.stop();
    }
}
