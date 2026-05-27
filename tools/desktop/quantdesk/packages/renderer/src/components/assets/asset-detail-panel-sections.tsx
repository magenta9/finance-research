import { Button } from '../button';
import { Input } from '../input';
import { Tag } from '../tag';

export const AssetTagManagementSection = ({
    assetTags,
    onAddTag,
    onDraftChange,
    onRemoveTag,
    suggestions,
    tagDraft,
}: {
    assetTags: string[];
    onAddTag: (tag: string) => void;
    onDraftChange: (value: string) => void;
    onRemoveTag: (tag: string) => void;
    suggestions: string[];
    tagDraft: string;
}) => (
    <section className="rounded-[20px] border border-[rgba(120,86,60,0.16)] bg-[rgba(255,252,248,0.76)] p-4 shadow-[0_12px_32px_rgba(61,43,31,0.05)]">
        <p className="text-xs uppercase tracking-[0.26em] text-[var(--color-muted)]">
            标签管理
        </p>
        <div className="mt-3 flex flex-wrap gap-2" data-testid="asset-tag-list">
            {assetTags.length === 0 ? (
                <span className="text-sm text-[var(--color-muted)]">尚未添加标签</span>
            ) : (
                assetTags.map((tag) => (
                    <Tag key={tag} onRemove={() => {
                        onRemoveTag(tag);
                    }}>
                        {tag}
                    </Tag>
                ))
            )}
        </div>

        <div className="mt-4 flex gap-3">
            <Input
                className="h-10 min-w-0 flex-1 rounded-[12px] border border-[color:var(--color-border)] bg-white/80 px-3 text-sm text-[var(--color-foreground)] outline-none placeholder:text-[var(--color-muted)]"
                data-testid="asset-tag-input"
                list="asset-tag-suggestions"
                onChange={(event) => {
                    onDraftChange(event.currentTarget.value);
                }}
                placeholder="输入标签，例如 core / hedge / watchlist"
                value={tagDraft}
            />
            <Button
                data-testid="asset-tag-add"
                onClick={() => {
                    onAddTag(tagDraft);
                }}
                tone="primary"
            >
                添加
            </Button>
        </div>
        <datalist id="asset-tag-suggestions">
            {suggestions.map((entry) => (
                <option key={entry} value={entry} />
            ))}
        </datalist>

        {suggestions.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
                {suggestions.slice(0, 8).map((entry) => (
                    <Button
                        className="rounded-full border border-[color:var(--color-border)] px-3 py-1 text-xs text-[var(--color-copy)] transition hover:border-[var(--color-highlight-soft)] hover:text-[var(--color-foreground)]"
                        key={entry}
                        onClick={() => {
                            onAddTag(entry);
                        }}
                        size="sm"
                        tone="ghost"
                        type="button"
                    >
                        {entry}
                    </Button>
                ))}
            </div>
        )}
    </section>
);

export const AssetMetadataSection = ({
    assetMetadata,
    coverageLabel,
    createdAt,
    updatedAt,
}: {
    assetMetadata: Record<string, unknown>;
    coverageLabel: string;
    createdAt: string;
    updatedAt: string;
}) => {
    const futuresRows = buildFuturesMetadataRows(assetMetadata);

    return <section className="rounded-[20px] border border-[rgba(120,86,60,0.16)] bg-[rgba(255,252,248,0.76)] p-4 shadow-[0_12px_32px_rgba(61,43,31,0.05)]">
        <p className="text-xs uppercase tracking-[0.26em] text-[var(--color-muted)]">
            元信息
        </p>
        <div className="mt-4 space-y-3 text-sm leading-6 text-[var(--color-copy)]">
            <MetadataRow label="创建时间" value={createdAt} />
            <MetadataRow label="更新时间" value={updatedAt} />
            <MetadataRow label="最新覆盖" value={coverageLabel} />
            {futuresRows.map((row) => <MetadataRow key={row.label} label={row.label} value={row.value} />)}
        </div>
    </section>;
};

const readMetadataText = (metadata: Record<string, unknown>, key: string) => {
    const value = metadata[key];
    return typeof value === 'string' && value.length > 0 ? value : null;
};

const formatContractType = (value: string | null) => {
    if (value === 'dominant_continuous') {
        return '商品期货主力';
    }
    if (value === 'fixed_contract') {
        return '固定合约';
    }
    return value ?? '未提供';
};

const formatSeriesAdjustment = (value: string | null) => {
    if (value === 'back_adjusted') {
        return '已调整';
    }
    if (value === 'raw_main_continuous') {
        return '原始主力连续，未做换月调整';
    }
    return value ?? '未提供';
};

const buildFuturesMetadataRows = (metadata: Record<string, unknown>) => {
    if (readMetadataText(metadata, 'instrumentType') !== 'futures') {
        return [];
    }

    return [
        { label: '合约类型', value: formatContractType(readMetadataText(metadata, 'contractType')) },
        { label: 'TuShare 代码', value: readMetadataText(metadata, 'tsCode') ?? '未提供' },
        { label: '底层品种', value: readMetadataText(metadata, 'underlyingSymbol') ?? '未提供' },
        { label: '交易所', value: readMetadataText(metadata, 'exchange') ?? '未提供' },
        { label: '价格口径', value: formatSeriesAdjustment(readMetadataText(metadata, 'seriesAdjustment')) },
        { label: '数据源', value: readMetadataText(metadata, 'priceSeriesSource') ?? '未提供' },
    ];
};

interface MetadataRowProps {
    label: string;
    value: string;
}

const MetadataRow = ({ label, value }: MetadataRowProps) => (
    <div className="rounded-[12px] border border-[rgba(120,86,60,0.12)] bg-[rgba(244,239,230,0.52)] px-3 py-2.5">
        <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--color-muted)]">{label}</p>
        <p className="mt-2 text-sm text-[var(--color-foreground)]">{value}</p>
    </div>
);