#!/usr/bin/env node
/**
 * rebuild-native.mjs — Rebuild native modules for Node.js or Electron ABI.
 *
 * Usage:
 *   node scripts/rebuild-native.mjs --target node
 *   node scripts/rebuild-native.mjs --target electron
 *
 * Tracks the current ABI target in node_modules/.native-target so
 * redundant rebuilds are skipped automatically.
 */

import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const markerPath = resolve(root, 'node_modules', '.native-target');
const require = createRequire(resolve(root, 'packages/main/package.json'));

const NATIVE_MODULES = ['better-sqlite3', 'keytar'];
const MARKER_SCHEMA_VERSION = 2;

// ---------------------------------------------------------------------------
// Parse arguments
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const targetIdx = args.indexOf('--target');
const forceIdx = args.indexOf('--force');
const force = forceIdx !== -1;

if (targetIdx === -1 || !args[targetIdx + 1]) {
    console.error('Usage: node scripts/rebuild-native.mjs --target <node|electron> [--force]');
    process.exit(1);
}

const target = args[targetIdx + 1];

if (target !== 'node' && target !== 'electron') {
    console.error(`Invalid target "${target}". Must be "node" or "electron".`);
    process.exit(1);
}

// ---------------------------------------------------------------------------
// Detect current state
// ---------------------------------------------------------------------------

function readMarker() {
    try {
        const raw = readFileSync(markerPath, 'utf-8').trim();

        if (raw.length === 0) {
            return null;
        }

        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function writeMarker(value) {
    writeFileSync(markerPath, JSON.stringify(value, null, 2) + '\n', 'utf-8');
}

function resolveModuleVersions() {
    return Object.fromEntries(
        NATIVE_MODULES.map((mod) => [mod, require(`${mod}/package.json`).version]),
    );
}

function resolveModuleRoot(mod) {
    return dirname(require.resolve(`${mod}/package.json`));
}

function directoryContainsNativeBinary(dirPath) {
    try {
        const entries = readdirSync(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            const entryPath = resolve(dirPath, entry.name);

            if (entry.isDirectory()) {
                if (directoryContainsNativeBinary(entryPath)) {
                    return true;
                }

                continue;
            }

            if (entry.isFile() && entry.name.endsWith('.node')) {
                return true;
            }
        }
    } catch {
        return false;
    }

    return false;
}

function resolveMissingNativeModules() {
    return NATIVE_MODULES.filter((mod) => !directoryContainsNativeBinary(resolveModuleRoot(mod)));
}

function resolveDesiredMarker() {
    const base = {
        schemaVersion: MARKER_SCHEMA_VERSION,
        target,
        platform: process.platform,
        arch: process.arch,
        modules: resolveModuleVersions(),
    };

    if (target === 'node') {
        return {
            ...base,
            runtime: {
                abi: process.versions.modules,
                name: 'node',
                napi: process.versions.napi,
                version: process.version,
            },
        };
    }

    return {
        ...base,
        runtime: {
            name: 'electron',
            version: require('electron/package.json').version,
        },
    };
}

function sameRecord(left, right) {
    const leftKeys = Object.keys(left ?? {}).sort();
    const rightKeys = Object.keys(right ?? {}).sort();

    if (leftKeys.length !== rightKeys.length) {
        return false;
    }

    return leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
}

function markerMatches(currentMarker, desiredMarker) {
    if (!currentMarker || currentMarker.schemaVersion !== MARKER_SCHEMA_VERSION) {
        return false;
    }

    if (currentMarker.target !== desiredMarker.target) {
        return false;
    }

    if (currentMarker.platform !== desiredMarker.platform || currentMarker.arch !== desiredMarker.arch) {
        return false;
    }

    if (!sameRecord(currentMarker.modules, desiredMarker.modules)) {
        return false;
    }

    if (desiredMarker.runtime.name === 'node') {
        return currentMarker.runtime?.name === 'node'
            && currentMarker.runtime?.version === desiredMarker.runtime.version
            && currentMarker.runtime?.abi === desiredMarker.runtime.abi
            && currentMarker.runtime?.napi === desiredMarker.runtime.napi;
    }

    return currentMarker.runtime?.name === 'electron'
        && currentMarker.runtime?.version === desiredMarker.runtime.version;
}

const current = readMarker();
const desired = resolveDesiredMarker();
const missingNativeModules = resolveMissingNativeModules();

if (!force && markerMatches(current, desired)) {
    if (missingNativeModules.length > 0) {
        console.log(`⚠ Native target marker matches ${target}, but bindings are missing for: ${missingNativeModules.join(', ')}. Rebuilding…`);
    } else {
        console.log(`✔ Native modules already built for ${target} — skipping (use --force to override)`);
        process.exit(0);
    }
}

// ---------------------------------------------------------------------------
// Rebuild
// ---------------------------------------------------------------------------

function run(cmd) {
    console.log(`  → ${cmd}`);
    execSync(cmd, { cwd: root, stdio: 'inherit', env: { ...process.env } });
}

console.log(`\n⚙ Rebuilding native modules for ${target}…\n`);

try {
    if (target === 'node') {
        // Plain rebuild against the running Node.js ABI
        for (const mod of NATIVE_MODULES) {
            run(`pnpm --filter @quantdesk/main rebuild ${mod}`);
        }
    } else {
        // Use @electron/rebuild to compile against Electron's ABI
        // -m packages/main: pnpm doesn't hoist native modules to root node_modules,
        //   so we point @electron/rebuild at the package that actually depends on them.
        const modulesArg = NATIVE_MODULES.join(',');
        run(`npx --no-install @electron/rebuild -f -o ${modulesArg} -m packages/main`);
    }
} catch (err) {
    console.error(`\n✖ Rebuild for ${target} failed\n`);
    // Clear marker so next run retries
    try { writeFileSync(markerPath, '', 'utf-8'); } catch { /* ignore */ }
    process.exit(1);
}

writeMarker(desired);
console.log(`\n✔ Native modules now targeting ${target}\n`);
