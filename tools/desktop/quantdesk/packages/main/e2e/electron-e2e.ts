import { randomInt } from 'node:crypto';

import electronPath from 'electron';

const isLinux = process.platform === 'linux';

const allocatePort = (usedPorts: Set<number>) => {
    for (;;) {
        const candidate = randomInt(30000, 60000);

        if (!usedPorts.has(candidate)) {
            usedPorts.add(candidate);
            return String(candidate);
        }
    }
};

export const electronE2EPath = electronPath as unknown as string;

export const electronE2EArgs = (entryPoint: string) => [
    ...(isLinux ? ['--no-sandbox'] : []),
    entryPoint,
];

export const electronE2EEnv = (extraEnv: Record<string, string> = {}) => {
    const usedPorts = new Set<number>();
    const wsBridgePort = allocatePort(usedPorts);

    return {
        ...process.env,
        QUANTDESK_WS_BRIDGE_PORT: wsBridgePort,
        VITE_WS_BRIDGE_PORT: wsBridgePort,
        ...extraEnv,
        ...(isLinux ? { ELECTRON_DISABLE_SANDBOX: '1' } : {}),
    };
};