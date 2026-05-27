import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';

import { describe, expect, test } from 'vitest';

import { electronE2EArgs, electronE2EEnv, electronE2EPath } from './electron-e2e';

interface ProbePayload {
    assistantContainsReadyToken: boolean;
    diagnosticsVisible: boolean;
    messageCount: number;
    modelSummary: string;
    riskAcknowledgedAfterAck: string;
    runState: string;
    runtimeState: string;
    sessionCount: number;
}

const workspaceRoot = process.cwd();
const electronEntry = path.join(workspaceRoot, 'packages/main/dist/index.js');
const realPiTest = process.env.QUANTDESK_RUN_REAL_PI_E2E === '1' ? test : test.skip;

const requireEnv = (name: string) => {
    const value = process.env[name];

    if (!value) {
        throw new Error(`Missing required environment variable ${name}.`);
    }

    return value;
};

describe('pi agent electron e2e', () => {
    realPiTest('covers the Pi risk gate and real runtime smoke path through the Pi UI', async () => {
        const seedConfigDir = requireEnv('QUANTDESK_E2E_PI_AGENT_CONFIG_SEED_DIR');
        const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'quantdesk-pi-agent-e2e-'));
        const targetConfigDir = path.join(userDataPath, 'pi-agent', 'config');

        await fs.mkdir(path.dirname(targetConfigDir), { recursive: true });
        await fs.cp(seedConfigDir, targetConfigDir, { recursive: true });

        const child = spawn(electronE2EPath, electronE2EArgs(electronEntry), {
            cwd: workspaceRoot,
            env: electronE2EEnv({
                QUANTDESK_E2E_PI_AGENT_PROBE: '1',
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
            .find((line) => line.includes('"type":"pi-agent-e2e-probe"'));

        expect(probeLine, stderr || stdout).toBeTruthy();

        const parsed = JSON.parse(probeLine!) as {
            payload: ProbePayload;
            type: string;
        };

        expect(parsed.type).toBe('pi-agent-e2e-probe');
        expect(parsed.payload.diagnosticsVisible).toBe(true);
        expect(parsed.payload.riskAcknowledgedAfterAck).toBe('1');
        expect(parsed.payload.messageCount).toBeGreaterThanOrEqual(2);
        expect(parsed.payload.runState).toBe('idle');
        expect(parsed.payload.sessionCount).toBe(1);
        expect(parsed.payload.runtimeState).not.toBe('error');
    }, 180_000);
});