import type { App, BrowserWindow } from 'electron';

interface ResearchProbePayload {
  artifactTypes: string[];
  contextHasDataSources: boolean;
  hasReport: boolean;
  hasPreflight: boolean;
  hasToolEvidenceSection: boolean;
  historyProjectionRuntimePi: boolean;
  preflightStatus: string | null;
  requestRuntimeMode: string | null;
  reviewGateCount: number;
  status: string;
  toolExecutionCount: number;
}

const buildProbeScript = () => `
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
      query: '宏观观察。请必须调用可用 QuantDesk 工具获取证据，然后只基于工具或本地数据输出结构化研究。',
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
    const reportToolSection = report?.sections?.find((section) => section.title === '工具证据');

    return {
      artifactTypes,
      contextHasDataSources: Array.isArray(contextArtifact?.payload?.dataSources) && contextArtifact.payload.dataSources.length > 0,
      hasPreflight: Boolean(completed.preflight),
      hasReport: Boolean(report),
      hasToolEvidenceSection: Boolean(reportToolSection && !reportToolSection.body.includes('没有记录工具执行证据')),
      historyProjectionRuntimePi: history.items.some((item) => item.id === request.id && item.projection?.runtimeMode === 'pi'),
      preflightStatus: completed.preflight?.status ?? null,
      requestRuntimeMode: completed.runtimeMode,
      reviewGateCount: artifacts.filter((artifact) => artifact.artifactType === 'review_gate').length,
      status: completed.status,
      toolExecutionCount: artifacts.filter((artifact) => artifact.artifactType === 'tool_execution').length,
    };
  })();
`;

export const runResearchE2eProbe = async ({
  app,
  window,
}: {
  app: App;
  window: BrowserWindow;
}) => {
  const payload = (await window.webContents.executeJavaScript(
    buildProbeScript(),
    true,
  )) as ResearchProbePayload;

  process.stdout.write(`${JSON.stringify({ type: 'research-e2e-probe', payload })}\n`);
  app.quit();
};
