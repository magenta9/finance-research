import type { LoggerLike } from '../logger';
import type { MarketDataOrchestrator } from './market-data-orchestrator';

const HISTORY_SYNC_INTERVAL_MS = 60 * 60 * 1000;

export class HistorySyncScheduler {
    private intervalHandle: NodeJS.Timeout | null = null;
    private running = false;

    private readonly marketDataOrchestrator: Pick<MarketDataOrchestrator, 'ensure'>;

    private readonly logger?: LoggerLike;

    constructor(
        marketDataOrchestrator: Pick<MarketDataOrchestrator, 'ensure'>,
        logger?: LoggerLike,
    ) {
        this.marketDataOrchestrator = marketDataOrchestrator;
        this.logger = logger;
    }

    start() {
        if (this.intervalHandle != null) {
            return;
        }

        this.intervalHandle = setInterval(() => {
            if (this.running) {
                this.logger?.info('main', 'hourly_history_sync_skipped', {
                    reason: 'previous-run-still-active',
                });
                return;
            }

            this.running = true;
            void this.marketDataOrchestrator.ensure({ intent: 'maintenance', priority: 'background', scope: 'repair-incomplete-history' })
                .then((result) => {
                    const summary = result.priceSummary;

                    if (!summary) {
                        return;
                    }

                    this.logger?.info('main', 'hourly_history_sync_completed', {
                        insertedRows: summary.insertedRows,
                        skippedAssetIds: summary.skippedAssetIds,
                        synchronizedAssetIds: summary.synchronizedAssetIds,
                        warningCount: summary.warnings.length,
                    });
                })
                .catch((error) => {
                    this.logger?.warn('main', 'hourly_history_sync_failed', {
                        error: error instanceof Error ? error.message : String(error),
                    });
                })
                .finally(() => {
                    this.running = false;
                });
        }, HISTORY_SYNC_INTERVAL_MS);
    }

    stop() {
        if (this.intervalHandle != null) {
            clearInterval(this.intervalHandle);
            this.intervalHandle = null;
        }
    }
}