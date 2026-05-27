import type { App, BrowserWindow } from 'electron';

interface SidecarProbePayload {
    firstSymbol: string | null;
    lookupCount: number;
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
    const deadline = Date.now() + ${timeoutMs};

    while (Date.now() < deadline) {
      const runtimeStatus = await window.api.system.getRuntimeStatus();

      if (runtimeStatus.sidecarReady && runtimeStatus.sidecarPid != null && runtimeStatus.sidecarPort != null) {
        const assets = await window.api.data.lookupAssets('SPY', 'US');
        return {
          firstSymbol: assets[0]?.symbol ?? null,
          lookupCount: assets.length,
          runtimeStatus,
        };
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    return {
      firstSymbol: null,
      lookupCount: 0,
      runtimeStatus: await window.api.system.getRuntimeStatus(),
    };
  })();
`;

export const runSidecarE2eProbe = async ({
    app,
    timeoutMs = 20_000,
    window,
}: {
    app: App;
    timeoutMs?: number;
    window: BrowserWindow;
}) => {
    const payload = (await window.webContents.executeJavaScript(
        buildProbeScript(timeoutMs),
        true,
    )) as SidecarProbePayload;

    process.stdout.write(`${JSON.stringify({ type: 'sidecar-e2e-probe', payload })}\n`);
    app.quit();
};