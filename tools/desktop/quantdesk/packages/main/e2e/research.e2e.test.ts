import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';

import { describe, expect, test } from 'vitest';

import { electronE2EArgs, electronE2EEnv, electronE2EPath } from './electron-e2e';

interface ProbePayload {
    artifactTypes: string[];
    contextHasDataSources: boolean;
    hasPreflight: boolean;
    hasReport: boolean;
    hasToolEvidenceSection: boolean;
    historyProjectionRuntimePi: boolean;
    preflightStatus: string | null;
    requestRuntimeMode: string | null;
    reviewGateCount: number;
    status: string;
    toolExecutionCount: number;
}

const workspaceRoot = process.cwd();
const electronEntry = path.join(workspaceRoot, 'packages/main/dist/index.js');
const realResearchTest = process.env.QUANTDESK_RUN_REAL_RESEARCH_E2E === '1' ? test : test.skip;

const requireEnv = (name: string) => {
    const value = process.env[name];

    if (!value) {
        throw new Error(`Missing required environment variable ${name}.`);
    }

    return value;
};

describe('research electron e2e', () => {
    realResearchTest('runs a real Pi-backed research request with tool provenance and history projection', async () => {
        const seedConfigDir = requireEnv('QUANTDESK_E2E_PI_AGENT_CONFIG_SEED_DIR');
        const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'quantdesk-research-e2e-'));
        const targetConfigDir = path.join(userDataPath, 'pi-agent', 'config');

        await fs.mkdir(path.dirname(targetConfigDir), { recursive: true });
        await fs.cp(seedConfigDir, targetConfigDir, { recursive: true });

        const child = spawn(electronE2EPath, electronE2EArgs(electronEntry), {
            cwd: workspaceRoot,
            env: electronE2EEnv({
                QUANTDESK_E2E_RESEARCH_PROBE: '1',
                QUANTDESK_E2E_USER_DATA_PATH: userDataPath,
                QUANTDESK_RESEARCH_RUNTIME: 'pi',
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
            .find((line) => line.includes('"type":"research-e2e-probe"'));

        expect(probeLine, stderr || stdout).toBeTruthy();

        const parsed = JSON.parse(probeLine!) as {
            payload: ProbePayload;
            type: string;
        };

        expect(parsed.type).toBe('research-e2e-probe');
        expect(parsed.payload.status).toBe('completed');
        expect(parsed.payload.requestRuntimeMode).toBe('pi');
        expect(parsed.payload.contextHasDataSources).toBe(true);
        expect(parsed.payload.hasPreflight).toBe(true);
        expect(parsed.payload.preflightStatus).toBeTruthy();
        expect(parsed.payload.hasReport).toBe(true);
        expect(parsed.payload.artifactTypes).toContain('context_snapshot');
        expect(parsed.payload.artifactTypes).toContain('report');
        expect(parsed.payload.reviewGateCount).toBeGreaterThan(0);
        expect(parsed.payload.toolExecutionCount).toBeGreaterThan(0);
        expect(parsed.payload.hasToolEvidenceSection).toBe(true);
        expect(parsed.payload.historyProjectionRuntimePi).toBe(true);
    }, 240_000);
});
