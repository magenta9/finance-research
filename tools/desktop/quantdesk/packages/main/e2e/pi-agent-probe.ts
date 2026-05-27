import type { App, BrowserWindow } from 'electron';

interface PiAgentProbePayload {
    assistantContainsReadyToken: boolean;
    diagnosticsVisible: boolean;
    messageCount: number;
    modelSummary: string;
    riskAcknowledgedAfterAck: string;
  runState: string;
    runtimeState: string;
    sessionCount: number;
}

const buildProbeScript = () => `
  (async () => {
    const READY_TOKEN = 'PI_E2E_READY';
    const PROMPT = '只回复字符串 PI_E2E_READY，不要使用工具，不要补充解释。';
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

export const runPiAgentE2eProbe = async ({
    app,
    window,
}: {
    app: App;
    window: BrowserWindow;
}) => {
    const payload = (await window.webContents.executeJavaScript(
        buildProbeScript(),
        true,
    )) as PiAgentProbePayload;

    process.stdout.write(`${JSON.stringify({ type: 'pi-agent-e2e-probe', payload })}\n`);
    app.quit();
};