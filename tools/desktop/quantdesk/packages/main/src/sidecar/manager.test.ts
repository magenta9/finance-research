import { describe, expect, test, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { LoggerLike } from '../logger';
import { createSidecarProcessEnv, SidecarManager } from './manager';

const createLoggerStub = () => ({
    close: vi.fn().mockResolvedValue(undefined),
    error: vi.fn(),
    fatal: vi.fn(),
    getLogDirectory: vi.fn().mockReturnValue(null),
    info: vi.fn(),
    warn: vi.fn(),
    write: vi.fn(),
}) satisfies LoggerLike;

describe('SidecarManager stderr parsing', () => {
    test('disables Python bytecode writes in child process env', () => {
        expect(createSidecarProcessEnv({
            baseEnv: {
                NO_PROXY: '127.0.0.1',
            },
            extraNoProxyDomains: ['.eastmoney.com'],
        })).toEqual(expect.objectContaining({
            NO_PROXY: '127.0.0.1,.eastmoney.com',
            PYTHONDONTWRITEBYTECODE: '1',
            PYTHONUNBUFFERED: '1',
            no_proxy: '127.0.0.1,.eastmoney.com',
        }));
    });

    test('loads only allowlisted sidecar variables from dotenv', () => {
        const tempDir = mkdtempSync(path.join(tmpdir(), 'quantdesk-env-'));
        writeFileSync(path.join(tempDir, '.env'), [
            'TUSHARE_TOKEN=secret-token',
            'PYTHONPATH=/tmp/evil',
        ].join('\n'));

        const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir);

        try {
            expect(createSidecarProcessEnv({ baseEnv: {} })).toEqual(expect.objectContaining({
                TUSHARE_TOKEN: 'secret-token',
            }));
            expect(createSidecarProcessEnv({ baseEnv: {} })).not.toHaveProperty('PYTHONPATH');
        } finally {
            cwdSpy.mockRestore();
            rmSync(tempDir, { force: true, recursive: true });
        }
    });

    test('loads sidecar dotenv from explicit project root path when cwd differs', () => {
        const tempDir = mkdtempSync(path.join(tmpdir(), 'quantdesk-project-env-'));
        writeFileSync(path.join(tempDir, '.env'), 'TUSHARE_TOKEN=project-root-token\nPYTHONPATH=/tmp/evil');

        try {
            const env = createSidecarProcessEnv({
                baseEnv: {},
                dotEnvPaths: [path.join(tempDir, '.env')],
            });

            expect(env).toEqual(expect.objectContaining({
                TUSHARE_TOKEN: 'project-root-token',
            }));
            expect(env).not.toHaveProperty('PYTHONPATH');
        } finally {
            rmSync(tempDir, { force: true, recursive: true });
        }
    });

    test('buffers split stderr chunks until a full JSON line arrives', () => {
        const logger = createLoggerStub();
        const manager = new SidecarManager({
            logger,
            resolveScriptPath: () => '/tmp/server.py',
        });

        (manager as unknown as { stderrBuffer: string }).stderrBuffer =
            '{"level":"error","message":"rpc_error","detail":"boom","traceback":["line 1\\n"';
        (manager as unknown as { drainStderrBuffer: (flushRemainder?: boolean) => void }).drainStderrBuffer();

        expect(logger.write).not.toHaveBeenCalled();

        (manager as unknown as { stderrBuffer: string }).stderrBuffer += ',"line 2\\n"]}\nplain-text-warning\n';
        (manager as unknown as { drainStderrBuffer: (flushRemainder?: boolean) => void }).drainStderrBuffer();

        expect(logger.write).toHaveBeenCalledWith(expect.objectContaining({
            error: 'boom',
            level: 'error',
            message: 'rpc_error',
            source: 'sidecar',
            stack: expect.stringContaining('line 1'),
        }));
        expect(logger.warn).toHaveBeenCalledWith(
            'sidecar',
            'plain-text-warning',
        );
    });

    test('drains trailing stderr content during shutdown cleanup', () => {
        const logger = createLoggerStub();
        const manager = new SidecarManager({
            logger,
            resolveScriptPath: () => '/tmp/server.py',
        });

        (manager as unknown as { stderrBuffer: string }).stderrBuffer = 'leftover stderr';
        (manager as unknown as { drainStderrBuffer: (flushRemainder?: boolean) => void }).drainStderrBuffer(true);

        expect(logger.warn).toHaveBeenCalledWith(
            'sidecar',
            'leftover stderr',
        );
        expect(manager.getStatus().lastError).toBe('leftover stderr');
    });
});