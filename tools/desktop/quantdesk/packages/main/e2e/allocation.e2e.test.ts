import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';

import { describe, expect, test } from 'vitest';

import { electronE2EArgs, electronE2EEnv, electronE2EPath } from './electron-e2e';

interface ProbePayload {
    activePlanNameAfterLoad: string;
    constrainedMaxWeight: number;
    durationMsForFive: number;
    durationMsForTwenty: number;
    durationMsForTwentyOne: number;
    expectedReturnAfterModeSwitch: number;
    expectedReturnAfterPlanLoad: number;
    expectedReturnForFive: number;
    exportFilename: string;
    exportedPlanAssetCount: number;
    exportedPlanMode: string;
    firstScenarioCount: number;
    maxWeightForFive: number;
    maxWeightForTwenty: number;
    maxWeightForTwentyOne: number;
    modeAfterSwitch: string;
    optimizerForTwenty: string;
    optimizerForTwentyOne: string;
    planCountAfterSave: number;
    planNames: string[];
    resultCountForFive: number;
    resultCountForTwenty: number;
    resultCountForTwentyOne: number;
    savedPlanName: string;
    scenarioNames: string[];
}

const workspaceRoot = process.cwd();
const electronEntry = path.join(workspaceRoot, 'packages/main/dist/index.js');

describe('allocation electron e2e', () => {
    test('covers the Phase 5-6 manual verification path through the real allocation UI', async () => {
        const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'quantdesk-allocation-e2e-'));
        const child = spawn(electronE2EPath, electronE2EArgs(electronEntry), {
            cwd: workspaceRoot,
            env: electronE2EEnv({
                QUANTDESK_E2E_ALLOCATION_PROBE: '1',
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
            .find((line) => line.includes('"type":"allocation-e2e-probe"'));

        expect(probeLine, stderr || stdout).toBeTruthy();

        const parsed = JSON.parse(probeLine!) as {
            payload: ProbePayload;
            type: string;
        };

        expect(parsed.type).toBe('allocation-e2e-probe');
        expect(parsed.payload.resultCountForFive).toBe(5);
        expect(parsed.payload.maxWeightForFive).toBeLessThan(0.5);
        expect(parsed.payload.firstScenarioCount).toBeGreaterThanOrEqual(5);
        expect(parsed.payload.planCountAfterSave).toBeGreaterThanOrEqual(1);
        expect(parsed.payload.savedPlanName).toBe('Phase 6 E2E Plan');
        expect(parsed.payload.planNames).toContain('Phase 6 E2E Plan');
        expect(parsed.payload.modeAfterSwitch).toBe('max_diversification');
        expect(parsed.payload.expectedReturnAfterModeSwitch).not.toBeCloseTo(parsed.payload.expectedReturnForFive, 6);
        expect(parsed.payload.activePlanNameAfterLoad).toBe('Phase 6 E2E Plan');
        expect(parsed.payload.expectedReturnAfterPlanLoad).toBeCloseTo(parsed.payload.expectedReturnForFive, 6);
        expect(parsed.payload.exportFilename).toContain('.json');
        expect(parsed.payload.exportedPlanMode).toBe('inverse_volatility');
        expect(parsed.payload.exportedPlanAssetCount).toBe(5);
        expect(parsed.payload.resultCountForTwenty).toBe(20);
        expect(parsed.payload.optimizerForTwenty).toBe('js');
        expect(parsed.payload.durationMsForTwenty).toBeLessThan(5_000);
        expect(parsed.payload.resultCountForTwentyOne).toBe(21);
        expect(parsed.payload.optimizerForTwentyOne).toBe('python');
        expect(parsed.payload.durationMsForTwentyOne).toBeLessThan(20_000);
        expect(parsed.payload.maxWeightForTwentyOne).toBeLessThan(0.5);
        expect(parsed.payload.maxWeightForFive).toBeGreaterThan(parsed.payload.constrainedMaxWeight);
        expect(parsed.payload.constrainedMaxWeight).toBeLessThanOrEqual(0.200001);
        expect(parsed.payload.scenarioNames).toEqual(
            expect.arrayContaining(['利率上升', '股市暴跌', '通胀飙升', '经济衰退', '温和增长']),
        );
    }, 120_000);
});