import path from 'node:path';
import { mkdirSync } from 'node:fs';

import type { DataServices } from './db/services';
import { DocsRagService } from './agent/rag/docs-rag-service';
import type { LoggerLike } from './logger';
import { PortfolioEngine } from './portfolio/engine';
import { createPiRuntimeGroup, type PiRuntimeGroup } from './pi/factory';
import { SidecarManager } from './sidecar/manager';
import { resolveSidecarPythonCommand } from './sidecar/python-command';
import { createMarketDataRuntimeGroup, type MarketDataRuntimeGroup } from './sidecar/runtime-group';

export { resolveSidecarPythonCommand } from './sidecar/python-command';
export type { PiRuntimeGroup } from './pi/factory';

const defaultExtraNoProxyDomains = ['.eastmoney.com', '.boc.cn', '.sina.com.cn', '.cninfo.com.cn'];

export interface RuntimeServices {
    agent: AgentRuntimeGroup;
    dataServices: DataServices;
    marketData: MarketDataRuntimeGroup;
    pi: PiRuntimeGroup;
}

export interface AgentRuntimeGroup {
    docsRagService: DocsRagService;
    portfolioEngine: PortfolioEngine;
}

export const resolvePiWrapperEntryFile = ({ isPackaged }: { isPackaged: boolean }) => (
    isPackaged
        ? path.join(process.resourcesPath, 'app.asar', 'packages', 'main', 'dist', 'pi', 'wrapper', 'cli.js')
        : path.resolve(process.cwd(), 'packages/main/dist/pi/wrapper/cli.js')
);

export const resolvePiRuntimeDirectories = (userDataPath: string) => {
    const root = path.join(userDataPath, 'pi-agent');

    return {
        agentDir: path.join(root, 'config'),
        sessionDir: path.join(root, 'sessions'),
        toolInvocationDir: path.join(root, 'tool-invocations'),
        workspaceDir: path.join(root, 'workspace'),
    };
};

export const ensurePiRuntimeDirectories = (directories: ReturnType<typeof resolvePiRuntimeDirectories>) => {
    for (const directory of Object.values(directories)) {
        mkdirSync(directory, { recursive: true });
    }
};

export const createRuntimeServices = ({
    dataServices,
    isPackaged,
    logger,
    shouldSkipInteractiveSync,
    userDataPath,
}: {
    dataServices: DataServices;
    isPackaged: boolean;
    logger?: LoggerLike;
    shouldSkipInteractiveSync?: () => boolean;
    userDataPath: string;
}): RuntimeServices => {
    const sidecarManager = new SidecarManager({
        extraNoProxyDomains: defaultExtraNoProxyDomains,
        logger,
        pythonCommand: resolveSidecarPythonCommand({ isPackaged }),
        resolveScriptPath: () =>
            isPackaged
                ? path.join(process.resourcesPath, 'sidecar', 'src', 'server.py')
                : path.resolve(process.cwd(), 'sidecar/src/server.py'),
    });
    const marketData = createMarketDataRuntimeGroup({
        dataServices,
        logger,
        sidecarManager,
    });
    const portfolioEngine = new PortfolioEngine(
        dataServices,
        marketData.sidecarRuntime,
        marketData.orchestrator,
        undefined,
        { shouldSkipInteractiveSync },
    );
    const docsRagService = new DocsRagService();
    const piDirectories = resolvePiRuntimeDirectories(userDataPath);
    ensurePiRuntimeDirectories(piDirectories);
    const pi = createPiRuntimeGroup({
        dataServices,
        directories: piDirectories,
        docsRagService,
        logger,
        marketDataPort: marketData.services.marketDataPort,
        marketSourceService: marketData.services.marketSourceService,
        portfolioEngine,
        priceSyncService: marketData.services.priceSyncService,
        researchProviderService: marketData.services.researchProviderService,
        spawnSpec: () => ({
            args: [resolvePiWrapperEntryFile({ isPackaged })],
            command: process.execPath,
            cwd: piDirectories.workspaceDir,
            env: {
                ...process.env,
                ELECTRON_RUN_AS_NODE: '1',
                QUANTDESK_PI_AGENT_DIR: piDirectories.agentDir,
                QUANTDESK_PI_SESSION_DIR: piDirectories.sessionDir,
                QUANTDESK_PI_TOOL_INVOCATION_DIR: piDirectories.toolInvocationDir,
                QUANTDESK_PI_WORKSPACE_DIR: piDirectories.workspaceDir,
            },
        }),
    });

    const agent: AgentRuntimeGroup = {
        docsRagService,
        portfolioEngine,
    };

    return {
        agent,
        dataServices,
        marketData,
        pi,
    };
};