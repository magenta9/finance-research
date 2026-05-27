"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// e2e/fund-history-sync-probe.ts
var fund_history_sync_probe_exports = {};
__export(fund_history_sync_probe_exports, {
  runFundHistorySyncE2eProbe: () => runFundHistorySyncE2eProbe
});
module.exports = __toCommonJS(fund_history_sync_probe_exports);
var buildProbeScript = (timeoutMs) => `
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

    const results = await window.api.data.lookupAssets('\u5DE5\u94F6\u524D\u6CBF\u533B\u7597', 'A');
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
var runFundHistorySyncE2eProbe = async ({
  app,
  timeoutMs = 45e3,
  window
}) => {
  const payload = await window.webContents.executeJavaScript(
    buildProbeScript(timeoutMs),
    true
  );
  process.stdout.write(`${JSON.stringify({ type: "fund-history-sync-e2e-probe", payload })}
`);
  app.quit();
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  runFundHistorySyncE2eProbe
});
