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

// e2e/allocation-probe.ts
var allocation_probe_exports = {};
__export(allocation_probe_exports, {
  runAllocationE2eProbe: () => runAllocationE2eProbe
});
module.exports = __toCommonJS(allocation_probe_exports);
var buildFixtureAssets = () => [
  ["SPY", "SPDR S&P 500 ETF Trust", "US", "equity", "USD"],
  ["QQQ", "Invesco QQQ Trust", "US", "equity", "USD"],
  ["AGG", "iShares Core U.S. Aggregate Bond ETF", "US", "fixed_income", "USD"],
  ["GLD", "SPDR Gold Shares", "US", "commodity", "USD"],
  ["VTI", "Vanguard Total Stock Market ETF", "US", "equity", "USD"],
  ["BND", "Vanguard Total Bond Market ETF", "US", "fixed_income", "USD"],
  ["TIP", "iShares TIPS Bond ETF", "US", "fixed_income", "USD"],
  ["VNQ", "Vanguard Real Estate ETF", "US", "alternative", "USD"],
  ["2800.HK", "Tracker Fund of Hong Kong", "HK", "equity", "HKD"],
  ["3110.HK", "Global X Hang Seng High Dividend ETF", "HK", "equity", "HKD"],
  ["510300", "\u6CAA\u6DF1300ETF", "A", "equity", "CNY"],
  ["159919", "\u5609\u5B9E\u6CAA\u6DF1300ETF", "A", "equity", "CNY"],
  ["511010", "\u56FD\u503AETF", "BOND", "fixed_income", "CNY"],
  ["511260", "\u5341\u5E74\u56FD\u503AETF", "BOND", "fixed_income", "CNY"],
  ["518880", "\u9EC4\u91D1ETF", "COMMODITY", "commodity", "CNY"],
  ["159915", "\u521B\u4E1A\u677FETF", "A", "equity", "CNY"],
  ["512100", "\u4E2D\u8BC11000ETF", "A", "equity", "CNY"],
  ["513500", "\u6807\u666E500ETF", "A", "equity", "CNY"],
  ["515790", "\u5149\u4F0FETF", "A", "equity", "CNY"],
  ["515220", "\u7164\u70ADETF", "A", "equity", "CNY"],
  ["SHY", "iShares 1-3 Year Treasury Bond ETF", "US", "fixed_income", "USD"]
].map(([symbol, name, market, assetClass, currency], index) => ({
  assetClass,
  currency,
  id: `allocation-e2e-${index + 1}`,
  market,
  metadata: { seed: "allocation-e2e" },
  name,
  symbol,
  tags: index < 6 ? ["core"] : index < 12 ? ["diversifier"] : ["satellite"]
}));
var buildDate = (offsetFromToday) => {
  const date = /* @__PURE__ */ new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + offsetFromToday);
  return date.toISOString().slice(0, 10);
};
var buildPriceSeries = ({
  assetId,
  basePrice,
  length = 430,
  source = "allocation-e2e"
}) => Array.from({ length }, (_, index) => {
  const date = buildDate(index - (length - 1));
  const trend = 1 + index * 19e-4;
  const seasonality = 1 + Math.sin(index / 13) * 0.028 + Math.cos(index / 21) * 0.016;
  const close = Number((basePrice * trend * seasonality).toFixed(4));
  return {
    adjustedClose: close,
    assetId,
    close,
    date,
    fetchedAt: (/* @__PURE__ */ new Date()).toISOString(),
    high: Number((close * 1.01).toFixed(4)),
    low: Number((close * 0.99).toFixed(4)),
    open: Number((close * 0.996).toFixed(4)),
    source,
    volume: 8e5 + index * 4500
  };
});
var buildFxSeries = (pair, baseRate, length = 430) => Array.from({ length }, (_, index) => ({
  date: buildDate(index - (length - 1)),
  pair,
  rate: Number((baseRate + Math.sin(index / 17) * 0.015).toFixed(6)),
  source: "allocation-e2e"
}));
var seedAllocationProbeData = (services) => {
  const assets = buildFixtureAssets();
  for (const existingAsset of services.repositories.assetRepository.list()) {
    services.repositories.assetRepository.delete(existingAsset.id);
  }
  for (const asset of assets) {
    services.repositories.assetRepository.create(asset);
  }
  assets.forEach((asset, index) => {
    services.repositories.priceRepository.insertMany(
      buildPriceSeries({
        assetId: asset.id,
        basePrice: 35 + index * 6
      })
    );
  });
  services.repositories.fxRateRepository.insertMany(buildFxSeries("USD/CNY", 7.18));
  services.repositories.fxRateRepository.insertMany(buildFxSeries("HKD/CNY", 0.918));
};
var buildProbeScript = () => `
  (async () => {
    const getNumber = (selector) => Number(document.querySelector(selector)?.textContent ?? '0');
    const getText = (selector) => document.querySelector(selector)?.textContent?.trim() ?? '';
    const getPlanNames = () => getText('[data-testid="allocation-plan-names"]').split(',').map((entry) => entry.trim()).filter(Boolean);
    const getScenarioNames = () => Array.from(document.querySelectorAll('[data-testid="allocation-scenario-grid"] h3')).map((element) => element.textContent?.trim() ?? '').filter(Boolean);
    const logs = [];

    const waitFor = async (predicate, timeoutMs = 20000) => {
      const startedAt = Date.now();

      while (Date.now() - startedAt < timeoutMs) {
        const result = predicate();

        if (result) {
          return result;
        }

        await new Promise((resolve) => setTimeout(resolve, 120));
      }

      throw new Error('Timed out waiting for allocation UI state. Logs=' + JSON.stringify(logs));
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

      if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement)) {
        throw new Error('Missing input ' + selector);
      }

      const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

      if (!setter) {
        throw new Error('Missing value setter for ' + selector);
      }

      setter.call(element, String(value));
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    };

    const clickFirst = (selector) => {
      logs.push('click first ' + selector);
      const element = document.querySelector(selector);

      if (!(element instanceof HTMLElement)) {
        throw new Error('Missing element ' + selector);
      }

      element.click();
    };

    await waitFor(() => document.querySelector('a[aria-label="\u914D\u7F6E\u65B9\u6848"]'));
    click('a[aria-label="\u914D\u7F6E\u65B9\u6848"]');
    await waitFor(() => document.querySelector('[data-testid="allocation-page"]'));
    await waitFor(() => getNumber('[data-testid="allocation-selected-count"]') >= 5);

    click('[data-testid="allocation-select-first-5"]');
    await waitFor(() => getNumber('[data-testid="allocation-selected-count"]') === 5);
    click('[data-testid="allocation-run-button"]');

    await waitFor(() => {
      const count = getText('[data-testid="allocation-weights-symbols"]').split(',').filter(Boolean).length;
      const duration = getNumber('[data-testid="allocation-duration-ms"]');
      return count === 5 && duration > 0;
    });

    const resultCountForFive = getText('[data-testid="allocation-weights-symbols"]').split(',').filter(Boolean).length;
    const durationMsForFive = getNumber('[data-testid="allocation-duration-ms"]');
    const expectedReturnForFive = getNumber('[data-testid="allocation-expected-return-value"]');
    const maxWeightForFive = getNumber('[data-testid="allocation-max-weight"]');
    const firstScenarioCount = getNumber('[data-testid="allocation-scenario-count"]');

    inputValue('[data-testid="allocation-plan-name-input"]', 'Phase 6 E2E Plan');
    click('[data-testid="allocation-save-plan-button"]');

    await waitFor(() => getNumber('[data-testid="allocation-plan-count"]') >= 1 && getText('[data-testid="allocation-plan-names"]').includes('Phase 6 E2E Plan'));

    const planCountAfterSave = getNumber('[data-testid="allocation-plan-count"]');
    const planNames = getPlanNames();
    const savedPlanName = planNames[0] ?? '';

    click('[data-testid="allocation-strategy-max_diversification"]');
    click('[data-testid="allocation-run-button"]');

    await waitFor(() => {
      const nextExpectedReturn = getNumber('[data-testid="allocation-expected-return-value"]');
      return getText('[data-testid="allocation-current-strategy"]') === 'max_diversification' && Math.abs(nextExpectedReturn - expectedReturnForFive) > 0.000001;
    });

    const modeAfterSwitch = getText('[data-testid="allocation-current-mode"]');
    const strategyAfterSwitch = getText('[data-testid="allocation-current-strategy"]');
    const expectedReturnAfterModeSwitch = getNumber('[data-testid="allocation-expected-return-value"]');

    clickFirst('[data-testid^="allocation-load-plan-"]');

    await waitFor(() => {
      const restoredMode = getText('[data-testid="allocation-current-mode"]');
      const restoredStrategy = getText('[data-testid="allocation-current-strategy"]');
      const restoredExpectedReturn = getNumber('[data-testid="allocation-expected-return-value"]');
      return restoredMode === 'inverse_volatility' && restoredStrategy === 'inverse_volatility' && Math.abs(restoredExpectedReturn - expectedReturnForFive) <= 0.000001;
    });

    const activePlanNameAfterLoad = getText('[data-testid="allocation-active-plan-name"]');
    const expectedReturnAfterPlanLoad = getNumber('[data-testid="allocation-expected-return-value"]');

    clickFirst('[data-testid^="allocation-export-plan-"]');

    await waitFor(() => getText('[data-testid="allocation-export-payload"]').includes('Phase 6 E2E Plan'));

    const exportFilename = getText('[data-testid="allocation-export-filename"]');
    const exportedPayload = JSON.parse(getText('[data-testid="allocation-export-payload"]'));
    const exportedPlanMode = exportedPayload.plan?.mode ?? '';
    const exportedPlanStrategy = exportedPayload.plan?.strategy ?? '';
    const exportedPlanAssetCount = exportedPayload.plan?.assets?.length ?? 0;

    click('[data-testid="allocation-select-first-20"]');
    await waitFor(() => getNumber('[data-testid="allocation-selected-count"]') === 20);
    click('[data-testid="allocation-run-button"]');

    await waitFor(() => {
      const count = getText('[data-testid="allocation-weights-symbols"]').split(',').filter(Boolean).length;
      const duration = getNumber('[data-testid="allocation-duration-ms"]');
      return count === 20 && duration !== durationMsForFive;
    });

    const resultCountForTwenty = getText('[data-testid="allocation-weights-symbols"]').split(',').filter(Boolean).length;
    const durationMsForTwenty = getNumber('[data-testid="allocation-duration-ms"]');
    const maxWeightForTwenty = getNumber('[data-testid="allocation-max-weight"]');
    const optimizerForTwenty = getText('[data-testid="allocation-optimizer"]');

    logs.push('run 21-asset allocation via window.api.portfolio.runAllocation');
    const assetIdsForPythonFallback = (await window.api.data.getAssets()).slice(0, 21).map((asset) => asset.id);
    const pythonStartedAt = performance.now();
    const pythonFallbackResult = await window.api.portfolio.runAllocation({
      assetIds: assetIdsForPythonFallback,
      baseCurrency: 'CNY',
      constraints: {
        allowLeverage: false,
        allowShort: false,
        maxClassWeight: {},
        maxSingleWeight: 0.35,
      },
      mode: 'inverse_volatility',
    });
    const resultCountForTwentyOne = pythonFallbackResult.allocations.length;
    const durationMsForTwentyOne = Math.round(performance.now() - pythonStartedAt);
    const maxWeightForTwentyOne = Math.max(...pythonFallbackResult.allocations.map((allocation) => allocation.weight));
    const optimizerForTwentyOne = pythonFallbackResult.diagnostics.optimizer;

    click('[data-testid="allocation-select-first-5"]');
    await waitFor(() => getNumber('[data-testid="allocation-selected-count"]') === 5);
    inputValue('[data-testid="allocation-max-single-input"]', '0.20');
    click('[data-testid="allocation-run-button"]');

    await waitFor(() => {
      const nextMaxWeight = getNumber('[data-testid="allocation-max-weight"]');
      const duration = getNumber('[data-testid="allocation-duration-ms"]');
      return nextMaxWeight <= 0.200001 && duration !== durationMsForTwenty;
    });

    const constrainedMaxWeight = getNumber('[data-testid="allocation-max-weight"]');
    const scenarioNames = getScenarioNames();

    return {
      activePlanNameAfterLoad,
      constrainedMaxWeight,
      durationMsForFive,
      durationMsForTwenty,
      durationMsForTwentyOne,
      expectedReturnAfterModeSwitch,
      expectedReturnAfterPlanLoad,
      expectedReturnForFive,
      exportFilename,
      exportedPlanAssetCount,
      exportedPlanMode,
      exportedPlanStrategy,
      firstScenarioCount,
      maxWeightForFive,
      maxWeightForTwenty,
      maxWeightForTwentyOne,
      modeAfterSwitch,
      strategyAfterSwitch,
      optimizerForTwenty,
      optimizerForTwentyOne,
      planCountAfterSave,
      planNames,
      resultCountForFive,
      resultCountForTwenty,
      resultCountForTwentyOne,
      savedPlanName,
      scenarioNames,
    };
  })();
`;
var runAllocationE2eProbe = async ({
  app,
  services,
  window
}) => {
  seedAllocationProbeData(services);
  const payload = await window.webContents.executeJavaScript(
    buildProbeScript(),
    true
  );
  process.stdout.write(`${JSON.stringify({ type: "allocation-e2e-probe", payload })}
`);
  app.quit();
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  runAllocationE2eProbe
});
