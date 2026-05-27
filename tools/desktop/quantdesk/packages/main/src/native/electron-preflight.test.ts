import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockSpawnSync = vi.fn();
const mockExistsSync = vi.fn((entryPath: string) => (
    entryPath.endsWith('scripts/rebuild-native.mjs') || entryPath.endsWith('packages/main/package.json')
));
const mockRequire = vi.fn();

vi.mock('node:child_process', () => ({
    spawnSync: mockSpawnSync,
}));

vi.mock('node:fs', () => ({
    existsSync: mockExistsSync,
}));

vi.mock('node:module', () => ({
    createRequire: vi.fn(() => mockRequire),
}));

describe('ensureElectronNativeModulesReady', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        mockExistsSync.mockImplementation((entryPath: string) => (
            entryPath.endsWith('scripts/rebuild-native.mjs') || entryPath.endsWith('packages/main/package.json')
        ));
    });

    test('rebuilds Electron native modules when bindings are missing', async () => {
        let rebuilt = false;

        mockSpawnSync.mockImplementation(() => {
            rebuilt = true;

            return {
                status: 0,
            };
        });

        mockRequire.mockImplementation((moduleName: string) => {
            if (!rebuilt) {
                throw new Error(`Could not locate the bindings file for ${moduleName}.node`);
            }

            if (moduleName === 'better-sqlite3') {
                return class FakeBetterSqlite3Database {
                    close() { }
                };
            }

            if (moduleName === 'keytar') {
                return { getPassword: vi.fn() };
            }

            throw new Error(`Unexpected module request: ${moduleName}`);
        });

        const { ensureElectronNativeModulesReady } = await import('./electron-preflight');

        expect(() => ensureElectronNativeModulesReady({ isPackaged: false })).not.toThrow();
        expect(mockSpawnSync).toHaveBeenCalledTimes(1);
        expect(mockSpawnSync).toHaveBeenCalledWith(
            expect.any(String),
            ['scripts/rebuild-native.mjs', '--target', 'electron', '--force'],
            expect.objectContaining({
                cwd: expect.any(String),
                env: process.env,
                stdio: 'inherit',
            }),
        );
    });
});