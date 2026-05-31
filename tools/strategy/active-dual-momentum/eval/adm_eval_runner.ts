/** @deprecated Use tools/strategy/eval/generic_eval_runner.ts instead. */
import fs from 'node:fs';

import type { ActiveDualMomentumDiagnostics, AllocationStrategyMix, Currency } from '../../../desktop/quantdesk/packages/shared/src/types/domain';
import { runActiveDualMomentumBacktest } from '../../../desktop/quantdesk/packages/main/src/portfolio/active-dual-momentum';
import {
    prepareActiveDualMomentumEvalCase,
    toActiveDualMomentumEvalStoredAsset,
    type ActiveDualMomentumEvalAssetInput,
    type ActiveDualMomentumEvalPriceCacheEntry,
} from './adm_eval_preparation';

interface EvalCase {
    assetIds: string[];
    basketSize: number;
    caseId: string;
    endDate: string;
    sampleIndex: number;
    skipReason?: string;
    startDate: string;
    symbols: string[];
    windowYears: number;
}

interface EvalPayload {
    assets: ActiveDualMomentumEvalAssetInput[];
    baseCurrency: Currency;
    cases: EvalCase[];
    pricesBySymbol: Record<string, ActiveDualMomentumEvalPriceCacheEntry>;
    strategyConfig: NonNullable<AllocationStrategyMix['activeDualMomentum']>;
}

const readStdin = () => fs.readFileSync(0, 'utf8');

const run = () => {
    const payload = JSON.parse(readStdin()) as EvalPayload;
    const assetBySymbol = new Map(payload.assets.map((asset) => [asset.symbol, toActiveDualMomentumEvalStoredAsset(asset)]));
    const rows = [];

    for (const testCase of payload.cases) {
        try {
            if (testCase.skipReason) {
                rows.push({
                    ...testCase,
                    error: testCase.skipReason,
                    status: 'skipped',
                });
                continue;
            }
            const preparedCase = prepareActiveDualMomentumEvalCase({
                assetBySymbol,
                baseCurrency: payload.baseCurrency,
                pricesBySymbol: payload.pricesBySymbol,
                symbols: testCase.symbols,
            });
            const result = runActiveDualMomentumBacktest({
                annualizedMeanReturns: preparedCase.meanReturns,
                annualizedVolatility: preparedCase.volatility,
                baseCurrency: payload.baseCurrency,
                calculationDateRange: { endDate: testCase.endDate, startDate: testCase.startDate },
                covariance: preparedCase.covariance,
                config: payload.strategyConfig,
                prepared: preparedCase.prepared,
            });
            const diagnostics = (result.diagnostics as { activeDualMomentum?: ActiveDualMomentumDiagnostics }).activeDualMomentum;
            rows.push({
                ...testCase,
                calmarRatio: diagnostics?.calmarRatio ?? null,
                error: result.error?.message ?? null,
                metrics: result.portfolioMetrics,
                status: result.error ? 'error' : 'ok',
                warnings: result.diagnostics.warnings,
                winRate: diagnostics?.winRate ?? null,
            });
        } catch (error) {
            rows.push({
                ...testCase,
                error: error instanceof Error ? error.message : String(error),
                status: 'error',
            });
        }
    }

    process.stdout.write(`${JSON.stringify({ rows })}\n`);
};

try {
    run();
} catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
}
