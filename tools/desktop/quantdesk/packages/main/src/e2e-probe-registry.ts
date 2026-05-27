import path from 'node:path';
import { createRequire } from 'node:module';

import type { App, BrowserWindow } from 'electron';

import type { DataServices } from './db/services';
import type { LoggerLike } from './logger';

const require = createRequire(__filename);

interface ProbeRunnerOptions {
    app: App;
    services?: DataServices;
    window: BrowserWindow;
}

type ProbeRunner = (options: ProbeRunnerOptions) => Promise<void>;

interface ProbeSpec {
    envVar: string;
    exportName: string;
    fileName: string;
    label: string;
    requiresServices?: boolean;
}

const probeRegistry: ProbeSpec[] = [
    {
        envVar: 'QUANTDESK_E2E_SIDECAR_PROBE',
        exportName: 'runSidecarE2eProbe',
        fileName: 'sidecar-probe.js',
        label: 'Sidecar E2E probe',
    },
    {
        envVar: 'QUANTDESK_E2E_ASSETS_PROBE',
        exportName: 'runAssetsPoolE2eProbe',
        fileName: 'assets-pool-probe.js',
        label: 'Assets pool E2E probe',
    },
    {
        envVar: 'QUANTDESK_E2E_ALLOCATION_PROBE',
        exportName: 'runAllocationE2eProbe',
        fileName: 'allocation-probe.js',
        label: 'Allocation E2E probe',
        requiresServices: true,
    },
    {
        envVar: 'QUANTDESK_E2E_PI_AGENT_PROBE',
        exportName: 'runPiAgentE2eProbe',
        fileName: 'pi-agent-probe.js',
        label: 'Agent E2E probe',
    },
    {
        envVar: 'QUANTDESK_E2E_RESEARCH_PROBE',
        exportName: 'runResearchE2eProbe',
        fileName: 'research-probe.js',
        label: 'Research E2E probe',
    },
    {
        envVar: 'QUANTDESK_E2E_FUND_HISTORY_SYNC_PROBE',
        exportName: 'runFundHistorySyncE2eProbe',
        fileName: 'fund-history-sync-probe.js',
        label: 'Fund history sync E2E probe',
    },
];

const loadProbeRunner = (spec: ProbeSpec): ProbeRunner => {
    const modulePath = path.resolve(__dirname, '../e2e-dist', spec.fileName);
    const loaded = require(modulePath) as Record<string, unknown>;
    const runner = loaded[spec.exportName];

    if (typeof runner !== 'function') {
        throw new Error(`Missing probe export ${spec.exportName} in ${modulePath}.`);
    }

    return runner as ProbeRunner;
};

export const runEnabledE2eProbes = ({
    app,
    logger,
    services,
    window,
}: ProbeRunnerOptions & { logger?: LoggerLike }) => {
    for (const spec of probeRegistry) {
        if (process.env[spec.envVar] !== '1') {
            continue;
        }

        try {
            const runner = loadProbeRunner(spec);

            if (spec.requiresServices && !services) {
                throw new Error(`${spec.label} requires data services.`);
            }

            void runner({
                app,
                services,
                window,
            }).catch((error) => {
                logger?.fatal(
                    'main',
                    `${spec.label} failed`,
                    error instanceof Error ? error : new Error(String(error)),
                );
                app.exit(1);
            });
        } catch (error) {
            logger?.fatal(
                'main',
                `${spec.label} failed to load`,
                error instanceof Error ? error : new Error(String(error)),
            );
            app.exit(1);
        }
    }
};