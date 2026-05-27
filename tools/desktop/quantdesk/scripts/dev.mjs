import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import path from 'node:path';

const require = createRequire(import.meta.url);

const defaultRendererPort = Number.parseInt(process.env.QUANTDESK_RENDERER_PORT ?? '5173', 10);
const configuredWsBridgePort = process.env.QUANTDESK_WS_BRIDGE_PORT ?? process.env.VITE_WS_BRIDGE_PORT;
const preferredWsBridgePort = configuredWsBridgePort == null ? null : Number.parseInt(configuredWsBridgePort, 10);

const tasks = [
    ['SHARED', ['pnpm', ['--filter', '@quantdesk/shared', 'dev']]],
    ['PRELOAD', ['pnpm', ['--filter', '@quantdesk/preload', 'dev']]],
    ['MAIN', ['pnpm', ['--filter', '@quantdesk/main', 'dev']]],
    ['RENDERER', ['pnpm', ['--filter', '@quantdesk/renderer', 'dev']]],
    ['ELECTRON', ['pnpm', ['dev:electron']]],
];

const colors = {
    SHARED: '\x1b[36m',
    PRELOAD: '\x1b[35m',
    MAIN: '\x1b[33m',
    RENDERER: '\x1b[32m',
    ELECTRON: '\x1b[34m',
};

const reset = '\x1b[0m';
const children = new Map();
let shuttingDown = false;
let exitCode = 0;

function log(label, message) {
    const color = colors[label] ?? '';
    process.stdout.write(`${color}${label}${reset} | ${message}\n`);
}

function prefixStream(label, stream) {
    let buffer = '';

    stream.on('data', chunk => {
        buffer += chunk.toString();
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';

        for (const line of lines) {
            if (line.length > 0) {
                log(label, line);
            }
        }
    });

    stream.on('end', () => {
        if (buffer.length > 0) {
            log(label, buffer);
            buffer = '';
        }
    });
}

function killChildren(signal = 'SIGTERM') {
    shuttingDown = true;
    for (const child of children.values()) {
        if (!child.killed) {
            child.kill(signal);
        }
    }
}

function exitNow(code) {
    if (process.exitCode === undefined) {
        process.exitCode = code;
    }
    setTimeout(() => process.exit(code), 50).unref();
}

function canBindPort(port) {
    return new Promise(resolve => {
        const server = createServer();
        let settled = false;

        /** @param {boolean} result */
        const finish = (result) => {
            if (settled) {
                return;
            }
            settled = true;

            if (server.listening) {
                server.close(() => resolve(result));
                return;
            }

            resolve(result);
        };

        server.once('error', () => finish(false));

        server.listen(port, '127.0.0.1', () => finish(true));
    });
}

async function resolveRendererPort() {
    if (Number.isInteger(defaultRendererPort) && defaultRendererPort > 0) {
        if (await canBindPort(defaultRendererPort)) {
            return defaultRendererPort;
        }
    }

    return await new Promise((resolve, reject) => {
        const server = createServer();

        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();

            if (address == null || typeof address === 'string') {
                server.close(() => reject(new Error('Failed to resolve a renderer port')));
                return;
            }

            const { port } = address;
            server.close(() => resolve(port));
        });
    });
}

async function resolveWsBridgePort() {
    if (Number.isInteger(preferredWsBridgePort) && preferredWsBridgePort > 0) {
        if (await canBindPort(preferredWsBridgePort)) {
            return preferredWsBridgePort;
        }
    }

    return await new Promise((resolve, reject) => {
        const server = createServer();

        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();

            if (address == null || typeof address === 'string') {
                server.close(() => reject(new Error('Failed to resolve a WS bridge port')));
                return;
            }

            const { port } = address;
            server.close(() => resolve(port));
        });
    });
}

function handleChildExit(label, code, signal) {
    children.delete(label);

    if (shuttingDown) {
        if (children.size === 0) {
            exitNow(exitCode || 0);
        }
        return;
    }

    if (code === 0 && signal == null) {
        log(label, 'exited unexpectedly');
        exitCode = 1;
    } else {
        log(label, `exited with code ${code ?? 'null'} signal ${signal ?? 'null'}`);
        exitCode = typeof code === 'number' && code !== 0 ? code : 1;
    }

    killChildren();
    if (children.size === 0) {
        exitNow(exitCode);
    }
}

function spawnTask(label, command, args) {
    const child = spawn(command, args, {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
        shell: false,
    });

    children.set(label, child);
    prefixStream(label, child.stdout);
    prefixStream(label, child.stderr);

    child.on('error', error => {
        log(label, error.message);
        exitCode = 1;
        killChildren();
        if (children.size === 0) {
            exitNow(exitCode);
        }
    });

    child.on('exit', (code, signal) => {
        handleChildExit(label, code, signal);
    });
}

function runCommand(command, args, env = process.env) {
    const result = spawnSync(command, args, {
        cwd: process.cwd(),
        env,
        stdio: 'inherit',
    });

    if (result.error) {
        throw result.error;
    }

    if (typeof result.status === 'number') {
        return result.status;
    }

    return result.signal === null ? 0 : 1;
}

function resolvePackageBin(packageName, binName) {
    const packageJsonPath = require.resolve(`${packageName}/package.json`);
    const packageJson = require(packageJsonPath);
    const binPath = typeof packageJson.bin === 'string'
        ? packageJson.bin
        : packageJson.bin?.[binName];

    if (!binPath) {
        throw new Error(`Unable to resolve ${binName} from ${packageName}`);
    }

    return path.join(path.dirname(packageJsonPath), binPath);
}

function runElectronOnly() {
    const rendererPort = process.env.QUANTDESK_RENDERER_PORT ?? '5173';
    const waitOnBin = resolvePackageBin('wait-on', 'wait-on');
    const electronmonBin = resolvePackageBin('electronmon', 'electronmon');
    const waitStatus = runCommand(process.execPath, [
        waitOnBin,
        `tcp:${rendererPort}`,
        'packages/shared/dist/index.js',
        'packages/preload/dist/index.js',
        'packages/main/dist/index.js',
    ]);

    if (waitStatus !== 0) {
        process.exit(waitStatus);
    }

    const rebuildStatus = runCommand(process.execPath, ['scripts/rebuild-native.mjs', '--target', 'electron']);
    if (rebuildStatus !== 0) {
        process.exit(rebuildStatus);
    }

    process.exit(runCommand(process.execPath, [electronmonBin, 'packages/main/dist/index.js'], {
        ...process.env,
        VITE_DEV_SERVER_URL: `http://127.0.0.1:${rendererPort}`,
    }));
}

if (process.argv.includes('--electron-only')) {
    runElectronOnly();
}

process.on('SIGINT', () => {
    exitCode = 130;
    killChildren('SIGINT');
});

process.on('SIGTERM', () => {
    exitCode = 143;
    killChildren('SIGTERM');
});

const rendererPort = await resolveRendererPort();
const wsBridgePort = await resolveWsBridgePort();
process.env.QUANTDESK_RENDERER_PORT = String(rendererPort);
process.env.VITE_DEV_SERVER_URL = `http://127.0.0.1:${rendererPort}`;
process.env.QUANTDESK_WS_BRIDGE_PORT = String(wsBridgePort);
process.env.VITE_WS_BRIDGE_PORT = String(wsBridgePort);

for (const [label, [command, args]] of tasks) {
    log(label, `starting ${[command, ...args].join(' ')}`);
    spawnTask(label, command, args);
}
