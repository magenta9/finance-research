import type { App, BrowserWindow } from 'electron';

interface AssetsPoolProbePayload {
  afterDeleteSymbols: string[];
  afterImportCount: number;
  filteredSymbols: string[];
  importedPreviewCount: number;
  logs?: string[];
  spyAdded: boolean;
  spyCandidateVisible: boolean;
  spyVisibleAfterAdd: boolean;
  hs300Added: boolean;
  spyTags: string[];
  tagFilteredSymbols: string[];
}

const buildProbeScript = () => `
  (async () => {
    const logs = [];
    const record = (message) => logs.push(message);

    try {
    const describePage = () => JSON.stringify({
      href: window.location.href,
      readyState: document.readyState,
      bodyText: document.body?.innerText?.slice(0, 240) ?? '',
      rootHtml: document.getElementById('root')?.innerHTML?.slice(0, 400) ?? '',
      title: document.title,
    });

    const waitFor = async (predicate, timeoutMs = 20000) => {
      const startedAt = Date.now();

      while (Date.now() - startedAt < timeoutMs) {
        const value = predicate();
        if (value) {
          return value;
        }
        await new Promise((resolve) => setTimeout(resolve, 120));
      }

      throw new Error('Timed out waiting for UI state. Page=' + describePage());
    };

    const click = (selector) => {
      record('click ' + selector);
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) {
        throw new Error('Missing element: ' + selector);
      }
      element.click();
      return element;
    };

    const inputValue = (selector, value) => {
      record('input ' + selector + ' = ' + value);
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) {
        throw new Error('Missing input: ' + selector);
      }

      const prototype = element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : element instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
      const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

      if (!valueSetter) {
        throw new Error('Missing value setter for: ' + selector);
      }

      element.focus();
      valueSetter.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return element;
    };

    const getCount = () => Number(document.querySelector('[data-testid="asset-visible-count"]')?.textContent ?? '0');
    const getSymbols = () => (document.querySelector('[data-testid="asset-visible-symbols"]')?.textContent ?? '').split(',').filter(Boolean);
    const getClasses = () => (document.querySelector('[data-testid="asset-visible-classes"]')?.textContent ?? '').split(',').filter(Boolean);

    await waitFor(() => document.querySelector('a[aria-label="资产池"]'));
    click('a[aria-label="资产池"]');
    record('navigated to assets');
    await waitFor(() => document.querySelector('[data-testid="assets-page"]'));

    inputValue('[data-testid="asset-lookup-input"]', 'SPY');
    click('[data-testid="asset-lookup-submit"]');
    await waitFor(() => document.querySelector('[data-testid="candidate-card-SPY-US"]'));
    const spyCandidateVisible = Boolean(document.querySelector('[data-testid="candidate-card-SPY-US"]'));

    click('[data-testid="add-candidate-SPY-US"]');
    await waitFor(() => getSymbols().includes('SPY'));
    const spyVisibleAfterAdd = getSymbols().includes('SPY');

    inputValue('[data-testid="asset-lookup-input"]', '沪深300');
    click('[data-testid="asset-lookup-submit"]');
    await waitFor(() => document.querySelector('[data-testid="candidate-card-510300-A"]') || document.querySelector('[data-testid="candidate-card-159919-A"]'));
    const hsCandidate = document.querySelector('[data-testid="add-candidate-510300-A"]') || document.querySelector('[data-testid="add-candidate-159919-A"]');
    if (!(hsCandidate instanceof HTMLElement)) {
      throw new Error('Missing HS300 add button');
    }
    hsCandidate.click();
    await waitFor(() => getSymbols().includes('510300') || getSymbols().includes('159919'));

    click('[data-testid="open-import-modal"]');
    await waitFor(() => document.querySelector('[data-testid="csv-import-textarea"]'));

    inputValue(
      '[data-testid="csv-import-textarea"]',
      [
        'symbol,name,market,assetClass,currency',
        'QQQ,Invesco QQQ Trust,US,equity,USD',
        'AGG,iShares Core U.S. Aggregate Bond ETF,US,fixed_income,USD',
        'GLD,SPDR Gold Shares,US,commodity,USD',
        'IEF,iShares 7-10 Year Treasury Bond ETF,US,fixed_income,USD',
        'VTI,Vanguard Total Stock Market ETF,US,equity,USD',
        'BND,Vanguard Total Bond Market ETF,US,fixed_income,USD',
        '2800.HK,Tracker Fund of Hong Kong,HK,equity,HKD',
        '511010,国债ETF,BOND,fixed_income,CNY',
        '518880,黄金ETF,COMMODITY,commodity,CNY',
        '159915,创业板ETF,A,equity,CNY',
      ].join('\\n'),
    );

    await waitFor(() => Number(document.querySelector('[data-testid="csv-preview-count"]')?.textContent ?? '0') === 10);
    const importedPreviewCount = Number(document.querySelector('[data-testid="csv-preview-count"]')?.textContent ?? '0');
    click('[data-testid="csv-import-confirm"]');
    await waitFor(() => getCount() >= 12);
    const afterImportCount = getCount();

    click('[data-testid="asset-row-SPY-US"]');
    await waitFor(() => document.querySelector('[data-testid="asset-detail-panel"]'));
    inputValue('[data-testid="asset-tag-input"]', 'momentum');
    click('[data-testid="asset-tag-add"]');
    await waitFor(() => (document.querySelector('[data-testid="asset-tag-list"]')?.textContent ?? '').includes('momentum'));
    const spyTags = Array.from(document.querySelectorAll('[data-testid="asset-tag-list"] span')).map((element) => element.textContent?.trim() ?? '').filter((value) => value && value !== '×');

    await waitFor(() => Boolean(document.querySelector('[data-testid="asset-filter-tag"] option[value="momentum"]')));
    inputValue('[data-testid="asset-filter-tag"]', 'momentum');
    await waitFor(() => getSymbols().length > 0 && getSymbols().every((symbol) => symbol === 'SPY'));
    const tagFilteredSymbols = getSymbols();

    inputValue('[data-testid="asset-filter-tag"]', '');
    await waitFor(() => getCount() >= afterImportCount);

    inputValue('[data-testid="asset-filter-class"]', 'equity');
    await waitFor(() => getClasses().length > 0 && getClasses().every((entry) => entry === 'equity'));
    const filteredSymbols = getSymbols();

    click('[data-testid="delete-asset-SPY-US"]');
    await waitFor(() => !getSymbols().includes('SPY'));
    const afterDeleteSymbols = getSymbols();

    return {
      afterDeleteSymbols,
      afterImportCount,
      filteredSymbols,
      importedPreviewCount,
      logs,
      spyAdded: spyVisibleAfterAdd,
      spyCandidateVisible,
      spyVisibleAfterAdd,
      hs300Added: afterImportCount >= 2,
      spyTags,
      tagFilteredSymbols,
    };
    } catch (error) {
      return {
        __error: {
          logs,
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : null,
        },
      };
    }
  })();
`;

export const runAssetsPoolE2eProbe = async ({
  app,
  window,
}: {
  app: App;
  window: BrowserWindow;
}) => {
  const handleConsoleMessage = (_event: Event, level: number, message: string) => {
    process.stdout.write(`${JSON.stringify({ type: 'assets-pool-console', payload: { level, message } })}\n`);
  };
  const webContentsWithConsoleEvents = window.webContents as BrowserWindow['webContents'] & {
    on: (event: 'console-message', listener: typeof handleConsoleMessage) => void;
    off: (event: 'console-message', listener: typeof handleConsoleMessage) => void;
  };

  webContentsWithConsoleEvents.on('console-message', handleConsoleMessage);

  const payload = (await window.webContents.executeJavaScript(buildProbeScript(), true)) as AssetsPoolProbePayload & {
    __error?: {
      logs: string[];
      message: string;
      stack: string | null;
    };
  };

  if (payload.__error) {
    process.stdout.write(`${JSON.stringify({ type: 'assets-pool-e2e-error', payload: payload.__error })}\n`);
    webContentsWithConsoleEvents.off('console-message', handleConsoleMessage);
    app.exit(1);
    return;
  }

  process.stdout.write(`${JSON.stringify({ type: 'assets-pool-e2e-probe', payload })}\n`);
  webContentsWithConsoleEvents.off('console-message', handleConsoleMessage);
  app.quit();
};