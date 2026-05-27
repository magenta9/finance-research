#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, readdirSync, readlinkSync, realpathSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtimeRoot = resolve(root, 'build', 'electron-main-runtime');
const runtimeNodeModules = resolve(runtimeRoot, 'node_modules');
const nativeModules = ['better-sqlite3', 'keytar'];

function collectTopLevelPackageNames() {
    return readdirSync(runtimeNodeModules, { withFileTypes: true })
        .flatMap((entry) => {
            if (entry.name.startsWith('.')) {
                return [];
            }

            if (entry.name.startsWith('@')) {
                return readdirSync(resolve(runtimeNodeModules, entry.name), { withFileTypes: true })
                    .map((scopedEntry) => `${entry.name}/${scopedEntry.name}`);
            }

            return [entry.name];
        });
}

function materializeTopLevelPackage(packageName) {
    const packageRoot = resolve(runtimeNodeModules, ...packageName.split('/'));

    if (!existsSync(packageRoot)) {
        console.error(`Missing deployed runtime package: ${packageRoot}`);
        process.exit(1);
    }

    const stats = lstatSync(packageRoot);

    if (!stats.isSymbolicLink()) {
        return;
    }

    const linkTarget = readlinkSync(packageRoot);
    const realPackageRoot = realpathSync(resolve(dirname(packageRoot), linkTarget));

    rmSync(packageRoot, { force: true, recursive: true });
    cpSync(realPackageRoot, packageRoot, { recursive: true });
}

function rebuildElectronNativeModules() {
    const result = spawnSync('npx', [
        '--no-install',
        '@electron/rebuild',
        '-f',
        '-o',
        nativeModules.join(','),
        '-m',
        runtimeRoot,
    ], {
        cwd: root,
        encoding: 'utf-8',
        stdio: 'inherit',
    });

    if (result.error) {
        throw result.error;
    }

    if ((result.status ?? 1) !== 0) {
        process.exit(result.status ?? 1);
    }
}

rmSync(runtimeRoot, { recursive: true, force: true });

const deploy = spawnSync('pnpm', [
    '--config.node-linker=hoisted',
    '--filter',
    '@quantdesk/main',
    'deploy',
    '--prod',
    runtimeRoot,
], {
    cwd: root,
    encoding: 'utf-8',
    stdio: 'inherit',
});

if (deploy.error) {
    throw deploy.error;
}

if ((deploy.status ?? 1) !== 0) {
    process.exit(deploy.status ?? 1);
}

if (!existsSync(runtimeNodeModules)) {
    console.error(`Missing deployed production node_modules: ${runtimeNodeModules}`);
    process.exit(1);
}

for (const packageName of collectTopLevelPackageNames()) {
    materializeTopLevelPackage(packageName);
}

rebuildElectronNativeModules();
