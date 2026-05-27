import type { PricePatternAnalog, PricePatternAnalogSearchResult } from '@quantdesk/shared';

import { Badge } from '../badge';
import { Button } from '../button';

interface AssetAnalogSectionProps {
    analogError: string | null;
    analogResult: PricePatternAnalogSearchResult | null;
    analogUnsupported: boolean;
    isLoadingAnalogs: boolean;
    onToggleAnalog: (analogId: string) => void;
    selectedAnalogIds: string[];
}

const formatPercent = (value: number | null) => {
    if (value == null || Number.isNaN(value)) {
        return '缺失';
    }

    return `${(value * 100).toFixed(2)}%`;
};

const formatScore = (value: number) => value.toFixed(1);

const sourceLabel = (analog: PricePatternAnalog) => (
    analog.sourceType === 'self' ? '同标的历史' : '同类标的'
);

const forwardLabel = (analog: PricePatternAnalog, horizon: '1M' | '3M' | '6M') => {
    const outcome = analog.forward[horizon];

    if (outcome.status === 'complete') {
        return `${horizon} ${formatPercent(outcome.return)}`;
    }

    if (outcome.status === 'partial') {
        return `${horizon} 不完整`;
    }

    return `${horizon} 缺失`;
};

const statusLabel = (status: PricePatternAnalogSearchResult['status']) => {
    if (status === 'ok') {
        return '可用';
    }

    if (status === 'degraded') {
        return '降级';
    }

    return '不可用';
};

export const AssetAnalogSection = ({
    analogError,
    analogResult,
    analogUnsupported,
    isLoadingAnalogs,
    onToggleAnalog,
    selectedAnalogIds,
}: AssetAnalogSectionProps) => {
    if (analogUnsupported) {
        return (
            <div className="rounded-[18px] border border-[rgba(120,86,60,0.14)] bg-[rgba(244,239,230,0.5)] px-4 py-3 text-sm text-[var(--color-copy)]" data-testid="asset-analog-unsupported">
                Analog 检索首版仅支持 3M、6M、1Y 同尺度窗口。
            </div>
        );
    }

    if (isLoadingAnalogs) {
        return (
            <div className="rounded-[18px] border border-[rgba(120,86,60,0.14)] bg-[rgba(255,252,248,0.76)] px-4 py-4 text-sm text-[var(--color-copy)]" data-testid="asset-analog-loading">
                正在检索本地历史 analog...
            </div>
        );
    }

    if (analogError) {
        return (
            <div className="rounded-[18px] border border-[rgba(159,58,41,0.18)] bg-[rgba(159,58,41,0.05)] px-4 py-3 text-sm text-[#7d2c22]" data-testid="asset-analog-error">
                Analog 检索失败：{analogError}
            </div>
        );
    }

    if (!analogResult) {
        return null;
    }

    const hasResults = analogResult.results.length > 0;

    return (
        <section className="rounded-[18px] border border-[rgba(120,86,60,0.14)] bg-[rgba(255,252,248,0.72)] p-4" data-testid="asset-analog-section">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <p className="text-xs uppercase tracking-[0.24em] text-[var(--color-muted)]">Historical analog</p>
                    <h3 className="mt-2 font-display text-xl leading-none text-[var(--color-foreground)]">历史形态类比</h3>
                    <p className="mt-2 text-sm leading-6 text-[var(--color-copy)]">
                        候选 {analogResult.candidateSummary.eligibleWindowCount}/{analogResult.candidateSummary.rawWindowCount}，去重后 {analogResult.candidateSummary.dedupedWindowCount}，已叠加 {selectedAnalogIds.length}。
                    </p>
                </div>
                <Badge tone={analogResult.status === 'ok' ? 'accent' : 'muted'}>{statusLabel(analogResult.status)}</Badge>
            </div>

            {analogResult.warnings.length > 0 && (
                <div className="mt-3 rounded-[14px] border border-[rgba(159,122,55,0.18)] bg-[rgba(159,122,55,0.08)] px-3 py-2 text-xs leading-5 text-[#87542f]" data-testid="asset-analog-warning">
                    {analogResult.warnings.join(' / ')}
                </div>
            )}

            {!hasResults && (
                <div className="mt-3 rounded-[14px] border border-[rgba(120,86,60,0.12)] bg-white/64 px-3 py-4 text-sm text-[var(--color-copy)]" data-testid="asset-analog-empty">
                    本地资产池暂无满足覆盖与质量阈值的历史 analog。
                </div>
            )}

            {hasResults && (
                <div className="mt-4 grid gap-3 md:grid-cols-2" data-testid="asset-analog-list">
                    {analogResult.results.map((analog) => {
                        const selected = selectedAnalogIds.includes(analog.id);

                        return (
                            <Button
                                aria-pressed={selected}
                                className={[
                                    'h-auto rounded-[16px] border px-3 py-3 text-left shadow-none transition',
                                    selected
                                        ? 'border-[rgba(47,109,98,0.42)] bg-[rgba(47,109,98,0.1)] text-[var(--color-foreground)]'
                                        : 'border-[rgba(120,86,60,0.14)] bg-white/78 text-[var(--color-copy)] hover:border-[rgba(111,69,32,0.28)] hover:bg-white',
                                ].join(' ')}
                                data-testid="asset-analog-card"
                                key={analog.id}
                                onClick={() => {
                                    onToggleAnalog(analog.id);
                                }}
                                tone="ghost"
                                type="button"
                            >
                                <span className="flex w-full flex-col gap-3">
                                    <span className="flex items-start justify-between gap-3">
                                        <span className="min-w-0">
                                            <span className="block text-sm font-semibold text-[var(--color-foreground)]">{analog.asset.symbol}</span>
                                            <span className="mt-1 block truncate text-xs text-[var(--color-muted)]">{analog.asset.name}</span>
                                        </span>
                                        <span className="rounded-full border border-[rgba(120,86,60,0.14)] bg-white/74 px-2 py-1 text-xs text-[var(--color-copy)]">
                                            {selected ? '已叠加' : sourceLabel(analog)}
                                        </span>
                                    </span>
                                    <span className="grid grid-cols-2 gap-2 text-xs text-[var(--color-copy)]">
                                        <span>分数 {formatScore(analog.similarity.score)}</span>
                                        <span>形态 {formatScore(analog.similarity.shapeScore)}</span>
                                        <span className="col-span-2">{analog.match.startDate} 至 {analog.match.endDate}</span>
                                    </span>
                                    <span className="flex flex-wrap gap-1.5 text-xs">
                                        {(['1M', '3M', '6M'] as const).map((horizon) => (
                                            <span
                                                className="rounded-full bg-[rgba(244,239,230,0.8)] px-2 py-1 text-[var(--color-copy)]"
                                                key={horizon}
                                            >
                                                {forwardLabel(analog, horizon)}
                                            </span>
                                        ))}
                                    </span>
                                </span>
                            </Button>
                        );
                    })}
                </div>
            )}
        </section>
    );
};