import path from 'node:path';

import { describe, expect, test, vi } from 'vitest';

const { existsSyncMock, mkdirSyncMock } = vi.hoisted(() => ({
    existsSyncMock: vi.fn(),
    mkdirSyncMock: vi.fn(),
}));

vi.mock('node:fs', () => ({
    existsSync: existsSyncMock,
    mkdirSync: mkdirSyncMock,
}));

import {
    ensurePiRuntimeDirectories,
    resolveProductionSkillPaths,
    resolveProductionProjectRoot,
    resolvePiRuntimeDirectories,
    resolvePiWrapperEntryFile,
    resolveSidecarPythonCommand,
    resolveStrategyQuantDataConfig,
} from './runtime-services';

describe('resolveSidecarPythonCommand', () => {
    test('uses the local venv when it exists', () => {
        existsSyncMock.mockImplementation((candidate: string) =>
            candidate.endsWith('sidecar/.venv/bin/python'),
        );

        expect(resolveSidecarPythonCommand({ isPackaged: false })).toBe(
            path.resolve(process.cwd(), 'sidecar/.venv/bin/python'),
        );
    });

    test('falls back to the launcher when the venv is missing', () => {
        existsSyncMock.mockImplementation((candidate: string) =>
            candidate.endsWith('sidecar/scripts/python-launcher.sh'),
        );

        expect(resolveSidecarPythonCommand({ isPackaged: false })).toBe(
            path.resolve(process.cwd(), 'sidecar/scripts/python-launcher.sh'),
        );
    });

    test('prefers the launcher in packaged builds', () => {
        existsSyncMock.mockImplementation((candidate: string) =>
            candidate.endsWith('sidecar/scripts/python-launcher.sh')
            || candidate.endsWith('sidecar/.venv/bin/python'),
        );

        const originalResourcesPath = process.resourcesPath;
        (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = path.resolve(process.cwd(), 'release');

        try {
            expect(resolveSidecarPythonCommand({ isPackaged: true })).toBe(
                path.resolve(process.cwd(), 'release/sidecar/scripts/python-launcher.sh'),
            );
        } finally {
            (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = originalResourcesPath;
        }
    });

    test('fails closed in packaged builds when sidecar Python resources are missing', () => {
        existsSyncMock.mockReturnValue(false);

        const originalResourcesPath = process.resourcesPath;
        (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = path.resolve(process.cwd(), 'release');

        try {
            expect(() => resolveSidecarPythonCommand({ isPackaged: true })).toThrow(
                'Missing packaged sidecar Python launcher and bundled interpreter',
            );
        } finally {
            (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = originalResourcesPath;
        }
    });

    test('resolves the development pi wrapper bundle entry', () => {
        expect(resolvePiWrapperEntryFile({ isPackaged: false })).toBe(
            path.resolve(process.cwd(), 'packages/main/dist/pi/wrapper/cli.js'),
        );
    });

    test('derives stable pi runtime directories from userData', () => {
        expect(resolvePiRuntimeDirectories('/tmp/quantdesk-user')).toEqual({
            agentDir: '/tmp/quantdesk-user/pi-agent/config',
            sessionDir: '/tmp/quantdesk-user/pi-agent/sessions',
            toolInvocationDir: '/tmp/quantdesk-user/pi-agent/tool-invocations',
            workspaceDir: '/tmp/quantdesk-user/pi-agent/workspace',
        });
    });

    test('creates every pi runtime directory recursively before startup', () => {
        const directories = resolvePiRuntimeDirectories('/tmp/quantdesk-user');

        ensurePiRuntimeDirectories(directories);

        expect(mkdirSyncMock).toHaveBeenCalledTimes(4);
        expect(mkdirSyncMock).toHaveBeenNthCalledWith(1, directories.agentDir, { recursive: true });
        expect(mkdirSyncMock).toHaveBeenNthCalledWith(2, directories.sessionDir, { recursive: true });
        expect(mkdirSyncMock).toHaveBeenNthCalledWith(3, directories.toolInvocationDir, { recursive: true });
        expect(mkdirSyncMock).toHaveBeenNthCalledWith(4, directories.workspaceDir, { recursive: true });
    });

    test('points Pi wrapper at the current repo production skills in development', () => {
        expect(resolveProductionSkillPaths({ isPackaged: false })).toEqual([
            path.resolve(process.cwd(), '../../..', '.agents', 'skills'),
        ]);
    });

    test('points strategy CLI at the current repo in development', () => {
        const originalQuantDataCli = process.env.QUANT_DATA_CLI;
        const originalQuantDataCliArgs = process.env.QUANT_DATA_CLI_ARGS;
        const originalQuantDataCwd = process.env.QUANT_DATA_CWD;
        const projectRoot = resolveProductionProjectRoot({ isPackaged: false });

        delete process.env.QUANT_DATA_CLI;
        delete process.env.QUANT_DATA_CLI_ARGS;
        delete process.env.QUANT_DATA_CWD;
        try {
            expect(projectRoot).toBe(path.resolve(process.cwd(), '../../..'));
            expect(resolveStrategyQuantDataConfig({ isPackaged: false, projectRoot })).toEqual({
                quantDataArgs: ['run', './cmd/quant-data'],
                quantDataCommand: 'go',
                quantDataCwd: path.join(projectRoot, 'tools', 'data', 'quant-data'),
            });
        } finally {
            if (originalQuantDataCli === undefined) {
                delete process.env.QUANT_DATA_CLI;
            } else {
                process.env.QUANT_DATA_CLI = originalQuantDataCli;
            }
            if (originalQuantDataCliArgs === undefined) {
                delete process.env.QUANT_DATA_CLI_ARGS;
            } else {
                process.env.QUANT_DATA_CLI_ARGS = originalQuantDataCliArgs;
            }
            if (originalQuantDataCwd === undefined) {
                delete process.env.QUANT_DATA_CWD;
            } else {
                process.env.QUANT_DATA_CWD = originalQuantDataCwd;
            }
        }
    });
});