import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';

import { describe, expect, test } from 'vitest';

import { electronE2EArgs, electronE2EEnv, electronE2EPath } from './electron-e2e';

interface ProbeEvent {
    insertedRows: number;
    occurredAt: string;
    outcome: 'failed' | 'success' | 'warning';
    warnings: string[];
}

interface ProbePayload {
    candidateIssueDate: string | null;
    candidateSymbol: string | null;
    completedTasks: number;
    createdAssetId: string | null;
    createdAssetIssueDate: string | null;
    failedTasks: number;
    lookupCount: number;
    priceCount: number;
    recentEvents: ProbeEvent[];
    runtimeStatus: {
        lastError: string | null;
        logDir: string | null;
        sidecarPid: number | null;
        sidecarPort: number | null;
        sidecarReady: boolean;
    };
}

const workspaceRoot = process.cwd();
const electronEntry = path.join(workspaceRoot, 'packages/main/dist/index.js');

describe('fund history sync electron e2e', () => {
    test('looks up a real fund, preserves issueDate, and queues background five-year backfill', async () => {
        const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'quantdesk-fund-sync-e2e-'));
        const child = spawn(electronE2EPath, electronE2EArgs(electronEntry), {
            cwd: workspaceRoot,
            env: electronE2EEnv({
                QUANTDESK_E2E_FUND_HISTORY_SYNC_PROBE: '1',
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
            .find((line) => line.includes('"type":"fund-history-sync-e2e-probe"'));

        expect(probeLine, stderr || stdout).toBeTruthy();

        const parsed = JSON.parse(probeLine!) as {
            payload: ProbePayload;
            type: string;
        };

        expect(parsed.type).toBe('fund-history-sync-e2e-probe');
        expect(parsed.payload.runtimeStatus.sidecarReady).toBe(true);
        expect(parsed.payload.runtimeStatus.sidecarPid).toEqual(expect.any(Number));
        expect(parsed.payload.runtimeStatus.sidecarPort).toEqual(expect.any(Number));
        expect(
            parsed.payload.runtimeStatus.lastError === null
            || parsed.payload.runtimeStatus.lastError.includes('slow_rpc'),
            parsed.payload.runtimeStatus.lastError ?? (stderr || stdout),
        ).toBe(true);
        expect(parsed.payload.lookupCount).toBeGreaterThan(0);
        expect(parsed.payload.candidateSymbol).toBe('001717');
        expect(parsed.payload.candidateIssueDate).toBe('2016-02-03');
        expect(parsed.payload.createdAssetId).toEqual(expect.any(String));
        expect(parsed.payload.createdAssetIssueDate).toBe('2016-02-03');
        expect(parsed.payload.completedTasks).toBeGreaterThanOrEqual(1);
        expect(parsed.payload.failedTasks).toBe(0);
        expect(parsed.payload.priceCount).toBeGreaterThan(0);
        expect(parsed.payload.recentEvents.length).toBeGreaterThan(0);
        expect(parsed.payload.recentEvents[0]?.insertedRows ?? 0).toBeGreaterThan(0);
        expect(['success', 'warning']).toContain(parsed.payload.recentEvents[0]?.outcome);
    }, 90_000);
});