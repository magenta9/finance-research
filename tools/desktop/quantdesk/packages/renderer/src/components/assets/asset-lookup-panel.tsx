import { memo, useMemo } from 'react';

import type { AssetLookupResult, Market } from '@quantdesk/shared';

import { Badge } from '../badge';
import { Button } from '../button';
import { SearchInput } from '../search-input';
import { Select } from '../select';

interface AssetLookupPanelProps {
    assets: Array<{ market: string; symbol: string }>;
    isLoading: boolean;
    lookupMarket: Market | 'ALL';
    lookupQuery: string;
    onAdd: (candidate: AssetLookupResult) => void;
    onLookup: () => void;
    onLookupMarketChange: (market: Market | 'ALL') => void;
    onLookupQueryChange: (query: string) => void;
    results: AssetLookupResult[];
}

const marketOptions: Array<{ label: string; value: Market | 'ALL' }> = [
    { label: '全部市场', value: 'ALL' },
    { label: 'A 股', value: 'A' },
    { label: '港股', value: 'HK' },
    { label: '美股', value: 'US' },
    { label: '债券', value: 'BOND' },
    { label: '商品', value: 'COMMODITY' },
];

const readIssueDate = (candidate: AssetLookupResult) => {
    const issueDate = candidate.metadata.issueDate;
    return typeof issueDate === 'string' && issueDate.length > 0 ? issueDate : null;
};

const readMetadataText = (metadata: Record<string, unknown>, key: string) => {
    const value = metadata[key];
    return typeof value === 'string' && value.length > 0 ? value : null;
};

const formatSeriesAdjustment = (value: string | null) => {
    if (value === 'back_adjusted') {
        return '已调整';
    }
    if (value === 'raw_main_continuous') {
        return '原始主力连续';
    }
    return '未提供';
};

const buildCandidateMetaLine = (candidate: AssetLookupResult) => {
    if (readMetadataText(candidate.metadata, 'instrumentType') !== 'futures') {
        const issueDate = readIssueDate(candidate);
        return `发行日期 ${issueDate ?? '未提供'}`;
    }

    const contractLabel = readMetadataText(candidate.metadata, 'contractType') === 'dominant_continuous'
        ? '商品期货主力'
        : '商品期货合约';
    const exchange = candidate.exchange ?? readMetadataText(candidate.metadata, 'exchange') ?? '交易所未提供';
    const source = candidate.source === 'tushare' ? 'TuShare' : candidate.source;
    const adjustment = formatSeriesAdjustment(readMetadataText(candidate.metadata, 'seriesAdjustment'));
    return `${contractLabel} / ${exchange} / ${source} / ${adjustment}`;
};

const buildAssetLookupKey = (asset: { market: string; symbol: string }) => `${asset.symbol}-${asset.market}`;

const AssetLookupPanelComponent = ({
    assets,
    isLoading,
    lookupMarket,
    lookupQuery,
    onAdd,
    onLookup,
    onLookupMarketChange,
    onLookupQueryChange,
    results,
}: AssetLookupPanelProps) => {
    const existingAssetKeys = useMemo(
        () => new Set(assets.map(buildAssetLookupKey)),
        [assets],
    );

    return (
        <section className="rounded-[20px] border border-[color:var(--color-border)] bg-[rgba(255,252,248,0.78)] p-4 shadow-[0_12px_32px_rgba(61,43,31,0.05)]">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-[var(--color-muted)]">
                        标的搜索与添加
                    </p>
                    <h2 className="mt-2 font-display text-2xl text-[var(--color-foreground)]">
                        从跨市场候选池添加资产
                    </h2>
                </div>
                <Badge tone="accent">候选结果 {results.length}</Badge>
            </div>

            <div className="mt-4 flex flex-col gap-3 xl:flex-row">
                <SearchInput
                    className="flex-1"
                    onChange={onLookupQueryChange}
                    onSubmit={onLookup}
                    placeholder="输入标的代码或名称，例如 SPY / 沪深300"
                    value={lookupQuery}
                    data-testid="asset-lookup-input"
                />
                <Select
                    className="h-10 rounded-[12px] border border-[color:var(--color-border)] bg-white/80 px-3 text-sm text-[var(--color-foreground)] xl:w-48"
                    onChange={(event) => {
                        onLookupMarketChange(event.currentTarget.value as Market | 'ALL');
                    }}
                    value={lookupMarket}
                    data-testid="asset-lookup-market"
                >
                    {marketOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                            {option.label}
                        </option>
                    ))}
                </Select>
                <Button
                    onClick={onLookup}
                    tone="primary"
                    data-testid="asset-lookup-submit"
                >
                    {isLoading ? '搜索中...' : '搜索候选'}
                </Button>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {results.length === 0 ? (
                    <div className="rounded-[16px] border border-dashed border-[color:var(--color-border)] bg-[rgba(244,239,230,0.46)] p-4 text-sm leading-6 text-[var(--color-copy)] md:col-span-2 2xl:col-span-3">
                        输入证券代码或名称后执行搜索。系统会优先通过 sidecar 查询跨市场候选资产。
                    </div>
                ) : (
                    results.map((candidate) => {
                        const candidateKey = buildAssetLookupKey(candidate);
                        const duplicate = existingAssetKeys.has(candidateKey);
                        const metaLine = buildCandidateMetaLine(candidate);

                        return (
                            <article
                                className="rounded-[16px] border border-[color:var(--color-border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(248,243,235,0.82))] p-4 shadow-[0_10px_26px_rgba(61,43,31,0.04)]"
                                key={candidateKey}
                                data-testid={`candidate-card-${candidate.symbol}-${candidate.market}`}
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <p className="text-xs uppercase tracking-[0.3em] text-[var(--color-muted)]">
                                            {candidate.market}
                                        </p>
                                        <h3 className="mt-2 font-display text-2xl text-[var(--color-foreground)]">
                                            {candidate.symbol}
                                        </h3>
                                        <p className="mt-2 text-sm leading-6 text-[var(--color-copy)]">
                                            {candidate.name}
                                        </p>
                                        <p className="mt-1 text-xs tracking-[0.06em] text-[var(--color-muted)]">
                                            {metaLine}
                                        </p>
                                    </div>
                                    <Badge tone={duplicate ? 'muted' : 'accent'}>
                                        {duplicate ? '已存在' : candidate.assetClass}
                                    </Badge>
                                </div>
                                <div className="mt-4 flex flex-wrap gap-2">
                                    <Badge>{candidate.currency}</Badge>
                                    <Badge>{candidate.source}</Badge>
                                    {readMetadataText(candidate.metadata, 'underlyingSymbol') ? (
                                        <Badge tone="muted">{readMetadataText(candidate.metadata, 'underlyingSymbol')}</Badge>
                                    ) : null}
                                </div>
                                <Button
                                    className="mt-4 w-full"
                                    disabled={duplicate}
                                    onClick={() => {
                                        onAdd(candidate);
                                    }}
                                    tone={duplicate ? 'ghost' : 'primary'}
                                    data-testid={`add-candidate-${candidate.symbol}-${candidate.market}`}
                                >
                                    {duplicate ? '已在资产池' : '添加到资产池'}
                                </Button>
                            </article>
                        );
                    })
                )}
            </div>
        </section>
    );
};

export const AssetLookupPanel = memo(AssetLookupPanelComponent);

AssetLookupPanel.displayName = 'AssetLookupPanel';
