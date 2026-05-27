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

// e2e/sidecar-probe.ts
var sidecar_probe_exports = {};
__export(sidecar_probe_exports, {
  runSidecarE2eProbe: () => runSidecarE2eProbe
});
module.exports = __toCommonJS(sidecar_probe_exports);
var buildProbeScript = (timeoutMs) => `
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
var runSidecarE2eProbe = async ({
  app,
  timeoutMs = 2e4,
  window
}) => {
  const payload = await window.webContents.executeJavaScript(
    buildProbeScript(timeoutMs),
    true
  );
  process.stdout.write(`${JSON.stringify({ type: "sidecar-e2e-probe", payload })}
`);
  app.quit();
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  runSidecarE2eProbe
});
