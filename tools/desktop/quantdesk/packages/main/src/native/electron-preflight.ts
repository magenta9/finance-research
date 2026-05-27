import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(__filename);

const NATIVE_MODULES = ['better-sqlite3', 'keytar'] as const;
const ABI_MISMATCH_PATTERNS = [
    'NODE_MODULE_VERSION',
    'compiled against a different Node.js version',
    'module version mismatch',
];
const MISSING_NATIVE_BINDING_PATTERNS = [
    'Could not locate the bindings file',
    'No native build was found for',
    '.node',
];

const resolveProjectRoot = () => {
    let currentDir = __dirname;

    for (; ;) {
        const rebuildScript = path.join(currentDir, 'scripts', 'rebuild-native.mjs');
        const mainPackage = path.join(currentDir, 'packages', 'main', 'package.json');

        if (existsSync(rebuildScript) && existsSync(mainPackage)) {
            return currentDir;
        }

        const parentDir = path.dirname(currentDir);

        if (parentDir === currentDir) {
            break;
        }

        currentDir = parentDir;
    }

    throw new Error('Unable to locate the QuantDesk project root for native module rebuild.');
};

const resolveNodeCommand = () => (
    process.env.npm_node_execpath
    ?? process.env.NODE
    ?? 'node'
);

const loadNativeModule = (moduleName: (typeof NATIVE_MODULES)[number]) => {
    const resolved = require(moduleName) as unknown | { default: unknown };

    return (typeof resolved === 'object' && resolved !== null && 'default' in resolved)
        ? resolved.default
        : resolved;
};

const assertNativeModuleLoads = (moduleName: (typeof NATIVE_MODULES)[number]) => {
    if (moduleName === 'better-sqlite3') {
        const BetterSqlite3Database = loadNativeModule(moduleName) as new (filename?: string) => {
            close: () => void;
        };
        const database = new BetterSqlite3Database(':memory:');

        database.close();
        return;
    }

    loadNativeModule(moduleName);
};

const isAbiMismatchError = (error: unknown) => {
    if (!(error instanceof Error)) {
        return false;
    }

    return ABI_MISMATCH_PATTERNS.some((pattern) => error.message.includes(pattern));
};

const isMissingNativeBindingError = (error: unknown) => {
    if (!(error instanceof Error)) {
        return false;
    }

    return MISSING_NATIVE_BINDING_PATTERNS.some((pattern) => error.message.includes(pattern));
};

const formatError = (moduleName: string, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);

    return `${moduleName}: ${message}`;
};

export const ensureElectronNativeModulesReady = ({
    isPackaged,
}: {
    isPackaged: boolean;
}) => {
    if (isPackaged) {
        return;
    }

    const loadFailures = NATIVE_MODULES.map((moduleName) => {
        try {
            assertNativeModuleLoads(moduleName);
            return null;
        } catch (error) {
            return {
                error,
                moduleName,
            };
        }
    }).filter((failure): failure is {
        error: unknown;
        moduleName: (typeof NATIVE_MODULES)[number];
    } => failure !== null);

    if (loadFailures.length === 0) {
        return;
    }

    const hasOnlyRecoverableNativeFailures = loadFailures.every((failure) => (
        isAbiMismatchError(failure.error) || isMissingNativeBindingError(failure.error)
    ));

    if (!hasOnlyRecoverableNativeFailures) {
        throw new Error(
            `Unable to load Electron native modules before bootstrap.\n${loadFailures
                .map((failure) => formatError(failure.moduleName, failure.error))
                .join('\n')}`,
        );
    }

    const projectRoot = resolveProjectRoot();
    const rebuildResult = spawnSync(
        resolveNodeCommand(),
        ['scripts/rebuild-native.mjs', '--target', 'electron', '--force'],
        {
            cwd: projectRoot,
            env: { ...process.env },
            stdio: 'inherit',
        },
    );

    if (rebuildResult.error) {
        throw rebuildResult.error;
    }

    if ((rebuildResult.status ?? 1) !== 0) {
        throw new Error(`Electron native module rebuild failed with exit code ${rebuildResult.status ?? 'null'}.`);
    }

    for (const moduleName of NATIVE_MODULES) {
        try {
            assertNativeModuleLoads(moduleName);
        } catch (error) {
            throw new Error(
                `Electron native module rebuild completed but ${formatError(moduleName, error)} remained unloadable.`,
            );
        }
    }
};