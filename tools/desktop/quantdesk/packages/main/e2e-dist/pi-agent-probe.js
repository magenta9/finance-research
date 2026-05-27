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

// e2e/pi-agent-probe.ts
var pi_agent_probe_exports = {};
__export(pi_agent_probe_exports, {
  runPiAgentE2eProbe: () => runPiAgentE2eProbe
});
module.exports = __toCommonJS(pi_agent_probe_exports);
var buildProbeScript = () => `
  (async () => {
    const READY_TOKEN = 'PI_E2E_READY';
    const PROMPT = '\u53EA\u56DE\u590D\u5B57\u7B26\u4E32 PI_E2E_READY\uFF0C\u4E0D\u8981\u4F7F\u7528\u5DE5\u5177\uFF0C\u4E0D\u8981\u8865\u5145\u89E3\u91CA\u3002';
    const logs = [];

    const getText = (selector) => document.querySelector(selector)?.textContent?.trim() ?? '';
    const getNumber = (selector) => Number(getText(selector) || '0');
    const hasElement = (selector) => Boolean(document.querySelector(selector));
    const getAssistantTexts = () => Array.from(document.querySelectorAll('[data-testid^="pi-agent-assistant-"]'))
      .map((element) => element.textContent?.trim() ?? '')
      .filter(Boolean);

    const waitFor = async (predicate, timeoutMs = 30000) => {
      const startedAt = Date.now();

      while (Date.now() - startedAt < timeoutMs) {
        const result = predicate();

        if (result) {
          return result;
        }

        await new Promise((resolve) => setTimeout(resolve, 120));
      }

      throw new Error('Timed out waiting for Agent UI state. Logs=' + JSON.stringify(logs));
    };

    const click = (selector) => {
      logs.push('click ' + selector);
      const element = document.querySelector(selector);

      if (!(element instanceof HTMLElement)) {
        throw new Error('Missing element ' + selector);
      }

      element.click();
    };

    const inputValue = (selector, value) => {
      logs.push('input ' + selector + ' = ' + value);
      const element = document.querySelector(selector);

      if (!(element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement)) {
        throw new Error('Missing input ' + selector);
      }

      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

      if (!setter) {
        throw new Error('Missing value setter for ' + selector);
      }

      setter.call(element, String(value));
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    };

    await waitFor(() => document.querySelector('a[aria-label="Agent"]'));
    click('a[aria-label="Agent"]');
    await waitFor(() => document.querySelector('[data-testid="pi-agent-page"]'));
    await waitFor(() => getText('[data-testid="pi-agent-risk-acknowledged"]') === '0');

    click('[data-testid="pi-agent-open-diagnostics"]');
    await waitFor(() => document.querySelector('[data-testid="pi-agent-runtime-diagnostics"]'));
    const diagnosticsVisible = hasElement('[data-testid="pi-agent-diagnostics-list"]');
    click('[data-testid="pi-agent-diagnostics-ack-risk"]');
    await waitFor(() => getText('[data-testid="pi-agent-risk-acknowledged"]') === '1');

    inputValue('[data-testid="pi-agent-message-input"]', PROMPT);
    click('[data-testid="pi-agent-send-button"]');

    await waitFor(() => {
      if (hasElement('[data-testid="pi-agent-run-failure-banner"]')) {
        throw new Error('Agent run failed after send. Logs=' + JSON.stringify(logs));
      }

      return getNumber('[data-testid="pi-agent-message-count"]') >= 2
        && getAssistantTexts().length > 0
        && getText('[data-testid="pi-agent-run-state"]') === 'idle';
    }, 120000);

    return {
      assistantContainsReadyToken: getAssistantTexts().some((text) => text.includes(READY_TOKEN)),
      diagnosticsVisible,
      messageCount: getNumber('[data-testid="pi-agent-message-count"]'),
      modelSummary: getText('[data-testid="pi-agent-model-readonly"]'),
      riskAcknowledgedAfterAck: getText('[data-testid="pi-agent-risk-acknowledged"]'),
      runState: getText('[data-testid="pi-agent-run-state"]'),
      runtimeState: getText('[data-testid="pi-agent-runtime-state"]'),
      sessionCount: getNumber('[data-testid="pi-agent-session-count"]'),
    };
  })();
`;
var runPiAgentE2eProbe = async ({
  app,
  window
}) => {
  const payload = await window.webContents.executeJavaScript(
    buildProbeScript(),
    true
  );
  process.stdout.write(`${JSON.stringify({ type: "pi-agent-e2e-probe", payload })}
`);
  app.quit();
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  runPiAgentE2eProbe
});
