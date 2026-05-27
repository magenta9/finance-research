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

// e2e/research-probe.ts
var research_probe_exports = {};
__export(research_probe_exports, {
  runResearchE2eProbe: () => runResearchE2eProbe
});
module.exports = __toCommonJS(research_probe_exports);
var buildProbeScript = () => `
  (async () => {
    const api = window.api;

    if (!api?.research) {
      throw new Error('Research API is unavailable in preload context.');
    }

    const waitFor = async (predicate, timeoutMs = 180000) => {
      const startedAt = Date.now();

      while (Date.now() - startedAt < timeoutMs) {
        const result = await predicate();

        if (result) {
          return result;
        }

        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      throw new Error('Timed out waiting for real research e2e request.');
    };

    await api.research.saveRiskProfile({
      baseCurrency: 'CNY',
      maxDrawdown: 0.15,
      maxSingleWeight: 0.12,
      riskTolerance: 'medium',
      singlePositionLossBudget: 0.02,
      updatedAt: new Date().toISOString(),
    });

    const request = await api.research.startResearch({
      query: '\u5B8F\u89C2\u89C2\u5BDF\u3002\u8BF7\u5FC5\u987B\u8C03\u7528\u53EF\u7528 QuantDesk \u5DE5\u5177\u83B7\u53D6\u8BC1\u636E\uFF0C\u7136\u540E\u53EA\u57FA\u4E8E\u5DE5\u5177\u6216\u672C\u5730\u6570\u636E\u8F93\u51FA\u7ED3\u6784\u5316\u7814\u7A76\u3002',
    });

    const completed = await waitFor(async () => {
      const latest = await api.research.getResearchRequest(request.id);

      if (!latest) {
        return null;
      }

      if (latest.status === 'failed') {
        throw new Error('Research request failed: ' + (latest.error || 'unknown error'));
      }

      return latest.status === 'completed' ? latest : null;
    });
    const artifacts = await api.research.getResearchArtifacts(request.id);
    const history = await api.research.listResearchRequests({ limit: 10, runtimeMode: 'pi' });
    const report = completed.report;
    const artifactTypes = artifacts.map((artifact) => artifact.artifactType);
    const contextArtifact = artifacts.find((artifact) => artifact.artifactType === 'context_snapshot');
    const reportToolSection = report?.sections?.find((section) => section.title === '\u5DE5\u5177\u8BC1\u636E');

    return {
      artifactTypes,
      contextHasDataSources: Array.isArray(contextArtifact?.payload?.dataSources) && contextArtifact.payload.dataSources.length > 0,
      hasPreflight: Boolean(completed.preflight),
      hasReport: Boolean(report),
      hasToolEvidenceSection: Boolean(reportToolSection && !reportToolSection.body.includes('\u6CA1\u6709\u8BB0\u5F55\u5DE5\u5177\u6267\u884C\u8BC1\u636E')),
      historyProjectionRuntimePi: history.items.some((item) => item.id === request.id && item.projection?.runtimeMode === 'pi'),
      preflightStatus: completed.preflight?.status ?? null,
      requestRuntimeMode: completed.runtimeMode,
      reviewGateCount: artifacts.filter((artifact) => artifact.artifactType === 'review_gate').length,
      status: completed.status,
      toolExecutionCount: artifacts.filter((artifact) => artifact.artifactType === 'tool_execution').length,
    };
  })();
`;
var runResearchE2eProbe = async ({
  app,
  window
}) => {
  const payload = await window.webContents.executeJavaScript(
    buildProbeScript(),
    true
  );
  process.stdout.write(`${JSON.stringify({ type: "research-e2e-probe", payload })}
`);
  app.quit();
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  runResearchE2eProbe
});
