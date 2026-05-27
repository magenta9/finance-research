import type { App, BrowserWindow } from 'electron';

interface FundHistorySyncProbeEvent {
  insertedRows: number;
  occurredAt: string;
  outcome: 'failed' | 'success' | 'warning';
  warnings: string[];
}

interface FundHistorySyncProbePayload {
  candidateIssueDate: string | null;
  candidateSymbol: string | null;
  completedTasks: number;
  createdAssetId: string | null;
  createdAssetIssueDate: string | null;
  failedTasks: number;
  lookupCount: number;
  priceCount: number;
  recentEvents: FundHistorySyncProbeEvent[];
  runtimeStatus: {
    lastError: string | null;
    logDir: string | null;
    sidecarPid: number | null;
    sidecarPort: number | null;
    sidecarReady: boolean;
  };
}

const buildProbeScript = (timeoutMs: number) => `
  (async () => {
    const wait = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));
    const readyDeadline = Date.now() + ${timeoutMs};

    while (Date.now() < readyDeadline) {
      const runtimeStatus = await window.api.system.getRuntimeStatus();

      if (runtimeStatus.sidecarReady && runtimeStatus.sidecarPid != null && runtimeStatus.sidecarPort != null) {
        break;
      }

      await wait(250);
    }

    const runtimeStatus = await window.api.system.getRuntimeStatus();
    if (!runtimeStatus.sidecarReady) {
      return {
        candidateIssueDate: null,
        candidateSymbol: null,
        completedTasks: 0,
        createdAssetId: null,
        createdAssetIssueDate: null,
        failedTasks: 0,
        lookupCount: 0,
        priceCount: 0,
        recentEvents: [],
        runtimeStatus,
      };
    }

    const results = await window.api.data.lookupAssets('工银前沿医疗', 'A');
    const candidate = results.find((entry) => entry.symbol === '001717') ?? results[0] ?? null;

    if (!candidate) {
      return {
        candidateIssueDate: null,
        candidateSymbol: null,
        completedTasks: 0,
        createdAssetId: null,
        createdAssetIssueDate: null,
        failedTasks: 0,
        lookupCount: results.length,
        priceCount: 0,
        recentEvents: [],
        runtimeStatus,
      };
    }

    const created = await window.api.data.addAsset({
      assetClass: candidate.assetClass,
      currency: candidate.currency,
      id: crypto.randomUUID(),
      market: candidate.market,
      metadata: candidate.metadata,
      name: candidate.name,
      symbol: candidate.symbol,
      tags: [],
    });

    const syncDeadline = Date.now() + ${timeoutMs};

    while (Date.now() < syncDeadline) {
      const syncStatus = await window.api.data.getSyncStatus();
      const prices = await window.api.data.getPrices(created.id);
      const relevantEvents = syncStatus.recentEvents.filter((event) => event.target === created.id);

      if (relevantEvents.length > 0 || prices.length > 0 || syncStatus.failedTasks > 0) {
        break;
      }

      await wait(250);
    }

    const finalStatus = await window.api.data.getSyncStatus();
    const finalPrices = await window.api.data.getPrices(created.id);
    const recentEvents = finalStatus.recentEvents
      .filter((event) => event.target === created.id)
      .map((event) => ({
        insertedRows: event.insertedRows,
        occurredAt: event.occurredAt,
        outcome: event.outcome,
        warnings: event.warnings,
      }));

    return {
      candidateIssueDate: typeof candidate.metadata?.issueDate === 'string' ? candidate.metadata.issueDate : null,
      candidateSymbol: candidate.symbol,
      completedTasks: finalStatus.completedTasks,
      createdAssetId: created.id,
      createdAssetIssueDate: typeof created.metadata?.issueDate === 'string' ? created.metadata.issueDate : null,
      failedTasks: finalStatus.failedTasks,
      lookupCount: results.length,
      priceCount: finalPrices.length,
      recentEvents,
      runtimeStatus: await window.api.system.getRuntimeStatus(),
    };
  })();
`;

export const runFundHistorySyncE2eProbe = async ({
  app,
  timeoutMs = 45_000,
  window,
}: {
  app: App;
  timeoutMs?: number;
  window: BrowserWindow;
}) => {
  const payload = (await window.webContents.executeJavaScript(
    buildProbeScript(timeoutMs),
    true,
  )) as FundHistorySyncProbePayload;

  process.stdout.write(`${JSON.stringify({ type: 'fund-history-sync-e2e-probe', payload })}\n`);
  app.quit();
};