#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, readlinkSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sidecarRoot = resolve(root, 'sidecar');
const sourceSidecarSourceRoot = resolve(sidecarRoot, 'src');
const sourceSidecarScriptsRoot = resolve(sidecarRoot, 'scripts');
const sourceVenvRoot = resolve(sidecarRoot, '.venv');
const stagingSidecarRoot = resolve(root, 'build', 'sidecar-package');
const sidecarSourceRoot = resolve(stagingSidecarRoot, 'src');
const sidecarScriptsRoot = resolve(stagingSidecarRoot, 'scripts');
const venvRoot = resolve(stagingSidecarRoot, '.venv');
const bundledPython = resolve(venvRoot, 'bin', 'python');
const bundledLibRoot = resolve(venvRoot, 'lib');

function isPathInside(candidatePath, parentPath) {
    const relativePath = relative(parentPath, candidatePath);

    return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

function assertProjectDirectory(dirPath, parentPath, label) {
    const stats = lstatSync(dirPath);

    if (stats.isSymbolicLink()) {
        throw new Error(`${label} must be a real directory, not a symlink: ${dirPath}`);
    }

    if (!stats.isDirectory()) {
        throw new Error(`${label} must be a directory: ${dirPath}`);
    }

    const realDirPath = realpathSync(dirPath);

    if (!isPathInside(realDirPath, parentPath)) {
        throw new Error(`${label} must stay inside ${parentPath}: ${realDirPath}`);
    }

    return realDirPath;
}

function assertRuntimePathInsidePrefixes(candidatePath, allowedPrefixes, label) {
    const realCandidatePath = realpathSync(candidatePath);

    if (!allowedPrefixes.some((prefix) => isPathInside(realCandidatePath, prefix))) {
        throw new Error(`${label} must stay inside the Python runtime root: ${realCandidatePath}`);
    }

    return realCandidatePath;
}

function removeBytecodeArtifacts(dirPath) {
    for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
        const entryPath = resolve(dirPath, entry.name);

        if (entry.isDirectory()) {
            if (entry.name === '__pycache__') {
                rmSync(entryPath, { recursive: true, force: true });
                continue;
            }

            removeBytecodeArtifacts(entryPath);
            continue;
        }

        if (entry.isFile() && (entry.name.endsWith('.pyc') || entry.name.endsWith('.pyo'))) {
            rmSync(entryPath, { force: true });
        }
    }
}

function ensureBundledPythonIsARealFile() {
    const stats = lstatSync(bundledPython);

    if (!stats.isSymbolicLink()) {
        return null;
    }

    const linkTarget = readlinkSync(bundledPython);
    const resolvedTarget = resolve(dirname(bundledPython), linkTarget);

    if (!existsSync(resolvedTarget)) {
        throw new Error(`Bundled Python symlink points to a missing target: ${bundledPython} -> ${linkTarget}`);
    }

    unlinkSync(bundledPython);
    copyFileSync(resolvedTarget, bundledPython);
    chmodSync(bundledPython, 0o755);

    return resolvedTarget;
}

function prepareStagingDirectory() {
    rmSync(stagingSidecarRoot, { recursive: true, force: true });
    mkdirSync(stagingSidecarRoot, { recursive: true });
    cpSync(sourceSidecarSourceRoot, sidecarSourceRoot, { recursive: true });
    cpSync(sourceSidecarScriptsRoot, sidecarScriptsRoot, { recursive: true });
    cpSync(sourceVenvRoot, venvRoot, { recursive: true });
}

function resolvePythonRuntime() {
    const result = spawnSync(bundledPython, [
        '-c',
        [
            'import json, sys, sysconfig',
            'payload = {"base_exec_prefix": sys.base_exec_prefix, "base_prefix": sys.base_prefix, "ldlibrary": sysconfig.get_config_var("LDLIBRARY"), "libdir": sysconfig.get_config_var("LIBDIR"), "stdlib": sysconfig.get_paths()["stdlib"], "version": f"{sys.version_info.major}.{sys.version_info.minor}"}',
            'print(json.dumps(payload))',
        ].join('; '),
    ], {
        encoding: 'utf-8',
        env: {
            ...process.env,
            PYTHONDONTWRITEBYTECODE: '1',
        },
    });

    if (result.error) {
        throw result.error;
    }

    if ((result.status ?? 1) !== 0) {
        throw new Error(`Failed to inspect bundled Python runtime: ${result.stderr.trim()}`);
    }

    const details = JSON.parse(result.stdout.trim());

    if (typeof details.version !== 'string' || !/^\d+\.\d+$/.test(details.version)) {
        throw new Error(`Unexpected Python version from bundled interpreter: ${String(details.version)}`);
    }

    if (typeof details.stdlib !== 'string' || typeof details.libdir !== 'string' || typeof details.ldlibrary !== 'string') {
        throw new Error('Bundled Python did not report stdlib, LIBDIR, and LDLIBRARY paths.');
    }

    const runtimePrefixes = [details.base_prefix, details.base_exec_prefix]
        .filter((value) => typeof value === 'string' && value.length > 0)
        .map((value) => realpathSync(value));

    if (runtimePrefixes.length === 0) {
        throw new Error('Bundled Python did not report a runtime root.');
    }

    const sourcePythonStdlib = assertRuntimePathInsidePrefixes(details.stdlib, runtimePrefixes, 'Python stdlib');
    const sourcePythonSharedLibrary = assertRuntimePathInsidePrefixes(
        resolve(details.libdir, details.ldlibrary),
        runtimePrefixes,
        'Python shared library',
    );

    return {
        pythonVersion: details.version,
        sourcePythonSharedLibrary,
        sourcePythonStdlib,
    };
}

function bundlePythonRuntime() {
    const { pythonVersion, sourcePythonStdlib, sourcePythonSharedLibrary } = resolvePythonRuntime();

    if (!existsSync(sourcePythonSharedLibrary)) {
        throw new Error(`Missing source Python shared library: ${sourcePythonSharedLibrary}`);
    }

    if (!existsSync(sourcePythonStdlib)) {
        throw new Error(`Missing source Python stdlib: ${sourcePythonStdlib}`);
    }

    pruneStaleRuntimeArtifacts(pythonVersion);
    pruneBundledStdlibDirectory(pythonVersion);
    copyFileSync(sourcePythonSharedLibrary, resolve(bundledLibRoot, basename(sourcePythonSharedLibrary)));
    cpSync(sourcePythonStdlib, resolve(bundledLibRoot, `python${pythonVersion}`), { recursive: true });

    return pythonVersion;
}

function pruneStaleRuntimeArtifacts(pythonVersion) {
    for (const entry of readdirSync(bundledLibRoot, { withFileTypes: true })) {
        const entryPath = resolve(bundledLibRoot, entry.name);

        if (entry.isFile() && /^libpython\d+\.\d+\.dylib$/.test(entry.name)) {
            rmSync(entryPath, { force: true });
            continue;
        }

        if (entry.isDirectory() && /^python\d+\.\d+$/.test(entry.name) && entry.name !== `python${pythonVersion}`) {
            rmSync(entryPath, { recursive: true, force: true });
        }
    }
}

function pruneBundledStdlibDirectory(pythonVersion) {
    const pythonLibRoot = resolve(bundledLibRoot, `python${pythonVersion}`);

    if (!existsSync(pythonLibRoot)) {
        return;
    }

    for (const entry of readdirSync(pythonLibRoot, { withFileTypes: true })) {
        if (entry.name === 'site-packages') {
            continue;
        }

        rmSync(resolve(pythonLibRoot, entry.name), { recursive: true, force: true });
    }
}

function recreatePythonAlias(aliasName) {
    const aliasPath = resolve(venvRoot, 'bin', aliasName);

    rmSync(aliasPath, { force: true });
    symlinkSync('python', aliasPath);
}

function normalizeBundledPythonLinks(pythonVersion) {
    recreatePythonAlias('python3');
    recreatePythonAlias(`python${pythonVersion}`);
}

function assertNoExternalSymlinks(dirPath, rootPath) {
    for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
        const entryPath = resolve(dirPath, entry.name);

        if (entry.isSymbolicLink()) {
            const targetPath = resolve(dirname(entryPath), readlinkSync(entryPath));
            const realTargetPath = realpathSync(targetPath);

            if (!isPathInside(realTargetPath, rootPath)) {
                throw new Error(`Sidecar package symlink points outside staging root: ${entryPath} -> ${realTargetPath}`);
            }

            continue;
        }

        if (entry.isDirectory()) {
            assertNoExternalSymlinks(entryPath, rootPath);
        }
    }
}

if (!existsSync(sourceVenvRoot)) {
    console.error(`Missing sidecar virtual environment: ${sourceVenvRoot}`);
    process.exit(1);
}

if (!existsSync(resolve(sourceVenvRoot, 'bin', 'python'))) {
    console.error(`Missing bundled Python executable: ${resolve(sourceVenvRoot, 'bin', 'python')}`);
    process.exit(1);
}

const rootRealPath = realpathSync(root);
const sidecarRootRealPath = assertProjectDirectory(sidecarRoot, rootRealPath, 'Sidecar root');
assertProjectDirectory(sourceVenvRoot, sidecarRootRealPath, 'Sidecar virtual environment');
assertProjectDirectory(sourceSidecarSourceRoot, sidecarRootRealPath, 'Sidecar source root');
assertProjectDirectory(sourceSidecarScriptsRoot, sidecarRootRealPath, 'Sidecar scripts root');

prepareStagingDirectory();

const stagingSidecarRootRealPath = assertProjectDirectory(stagingSidecarRoot, rootRealPath, 'Sidecar staging root');
assertProjectDirectory(venvRoot, stagingSidecarRootRealPath, 'Staged sidecar virtual environment');
assertProjectDirectory(sidecarSourceRoot, stagingSidecarRootRealPath, 'Staged sidecar source root');
assertProjectDirectory(sidecarScriptsRoot, stagingSidecarRootRealPath, 'Staged sidecar scripts root');

ensureBundledPythonIsARealFile();
const pythonVersion = bundlePythonRuntime();
normalizeBundledPythonLinks(pythonVersion);
removeBytecodeArtifacts(venvRoot);
removeBytecodeArtifacts(sidecarSourceRoot);
assertNoExternalSymlinks(stagingSidecarRoot, stagingSidecarRootRealPath);
