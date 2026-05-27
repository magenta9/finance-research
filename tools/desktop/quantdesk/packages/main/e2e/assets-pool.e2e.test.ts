import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';

import { describe, expect, test } from 'vitest';

import { electronE2EArgs, electronE2EEnv, electronE2EPath } from './electron-e2e';

interface ProbePayload {
    afterDeleteSymbols: string[];
    afterImportCount: number;
    filteredSymbols: string[];
    importedPreviewCount: number;
    spyAdded: boolean;
    spyCandidateVisible: boolean;
    spyVisibleAfterAdd: boolean;
    hs300Added: boolean;
    spyTags: string[];
    tagFilteredSymbols: string[];
}

const workspaceRoot = process.cwd();
const electronEntry = path.join(workspaceRoot, 'packages/main/dist/index.js');

describe('assets pool electron e2e', () => {
    test('covers the Phase 4 manual validation path inside the real Electron shell', async () => {
        const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'quantdesk-assets-e2e-'));
        const child = spawn(electronE2EPath, electronE2EArgs(electronEntry), {
            cwd: workspaceRoot,
            env: electronE2EEnv({
                QUANTDESK_E2E_ASSETS_PROBE: '1',
                QUANTDESK_E2E_USER_DATA_PATH: userDataPath,
            }),
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
        });

        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });

        const [exitCode] = (await once(child, 'close')) as [number | null];
        await fs.rm(userDataPath, { force: true, recursive: true });

        expect(exitCode, stderr || stdout).toBe(0);

        const probeLine = stdout
            .split(/\r?\n/)
            .map((line) => line.trim())
            .find((line) => line.includes('"type":"assets-pool-e2e-probe"'));

        expect(probeLine, stderr || stdout).toBeTruthy();

        const parsed = JSON.parse(probeLine!) as {
            payload: ProbePayload;
            type: string;
        };

        expect(parsed.type).toBe('assets-pool-e2e-probe');
        expect(parsed.payload.spyCandidateVisible).toBe(true);
        expect(parsed.payload.spyVisibleAfterAdd).toBe(true);
        expect(parsed.payload.spyAdded).toBe(true);
        expect(parsed.payload.hs300Added).toBe(true);
        expect(parsed.payload.importedPreviewCount).toBe(10);
        expect(parsed.payload.afterImportCount).toBeGreaterThanOrEqual(12);
        expect(parsed.payload.filteredSymbols.length).toBeGreaterThan(0);
        expect(parsed.payload.spyTags).toContain('momentum');
        expect(parsed.payload.tagFilteredSymbols).toEqual(['SPY']);
        expect(parsed.payload.afterDeleteSymbols).not.toContain('SPY');
    }, 120_000);
});