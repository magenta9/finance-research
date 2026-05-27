import { memo } from 'react';

import type { CsvImportResult } from '@quantdesk/shared';

import { Button } from '../button';
import { DataTable } from '../data-table';
import { Modal } from '../modal';
import { Textarea } from '../textarea';
import type { CsvPreview } from '../../stores/asset-store';

interface CsvImportModalProps {
    csvDraft: string;
    importResult: CsvImportResult | null;
    isImporting: boolean;
    onChange: (value: string) => void;
    onClose: () => void;
    onImport: () => void;
    open: boolean;
    preview: CsvPreview | null;
}

const CsvImportModalComponent = ({
    csvDraft,
    importResult,
    isImporting,
    onChange,
    onClose,
    onImport,
    open,
    preview,
}: CsvImportModalProps) => (
    <Modal
        actions={(
            <>
                <Button onClick={onClose} tone="ghost">取消</Button>
                <Button
                    disabled={!preview?.isValid || preview.totalRows === 0 || isImporting}
                    onClick={onImport}
                    tone="primary"
                    data-testid="csv-import-confirm"
                >
                    {isImporting ? '导入中...' : '确认导入'}
                </Button>
            </>
        )}
        description="将 CSV 粘贴到下方输入框。系统会先解析预览，再执行批量导入。"
        onClose={onClose}
        open={open}
        title="CSV 批量导入"
    >
        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
            <div>
                <p className="text-xs uppercase tracking-[0.26em] text-[var(--color-muted)]">
                    CSV 原文
                </p>
                <Textarea
                    className="mt-3 min-h-[300px] w-full rounded-[24px] border border-[color:var(--color-border)] bg-[rgba(255,255,255,0.84)] px-4 py-4 text-sm leading-6 text-[var(--color-foreground)] outline-none placeholder:text-[var(--color-muted)]"
                    onChange={(event) => {
                        onChange(event.currentTarget.value);
                    }}
                    placeholder={'symbol,name,market,assetClass,currency\nSPY,SPDR S&P 500 ETF Trust,US,equity,USD'}
                    value={csvDraft}
                    data-testid="csv-import-textarea"
                />
            </div>

            <div>
                <p className="text-xs uppercase tracking-[0.26em] text-[var(--color-muted)]">
                    预览与校验
                </p>
                <div className="mt-3 rounded-[24px] border border-[color:var(--color-border)] bg-[rgba(255,255,255,0.84)] p-4">
                    {preview?.error ? (
                        <p className="text-sm leading-6 text-[#7d2c22]">{preview.error}</p>
                    ) : (
                        <div className="space-y-4">
                            <div className="grid gap-3 md:grid-cols-3">
                                <div className="rounded-[20px] border border-[color:var(--color-border)] bg-[rgba(244,239,230,0.54)] p-4">
                                    <p className="text-xs uppercase tracking-[0.24em] text-[var(--color-muted)]">预览条数</p>
                                    <p className="mt-2 font-display text-3xl text-[var(--color-foreground)]" data-testid="csv-preview-count">
                                        {preview?.totalRows ?? 0}
                                    </p>
                                </div>
                                <div className="rounded-[20px] border border-[color:var(--color-border)] bg-[rgba(244,239,230,0.54)] p-4">
                                    <p className="text-xs uppercase tracking-[0.24em] text-[var(--color-muted)]">导入成功</p>
                                    <p className="mt-2 font-display text-3xl text-[var(--color-foreground)]">
                                        {importResult?.successCount ?? 0}
                                    </p>
                                </div>
                                <div className="rounded-[20px] border border-[color:var(--color-border)] bg-[rgba(244,239,230,0.54)] p-4">
                                    <p className="text-xs uppercase tracking-[0.24em] text-[var(--color-muted)]">跳过 / 错误</p>
                                    <p className="mt-2 font-display text-3xl text-[var(--color-foreground)]">
                                        {(importResult?.skippedCount ?? 0) + (importResult?.errorCount ?? 0)}
                                    </p>
                                </div>
                            </div>

                            <DataTable
                                columns={[
                                    { header: '代码', key: 'symbol', render: (row) => row.symbol },
                                    { header: '名称', key: 'name', render: (row) => row.name },
                                    { header: '市场', key: 'market', render: (row) => row.market },
                                    { header: '类别', key: 'assetClass', render: (row) => row.assetClass },
                                    { header: '货币', key: 'currency', render: (row) => row.currency },
                                ]}
                                emptyState="粘贴 CSV 后，这里会显示前几行预览。"
                                getRowKey={(row) => `${row.symbol}-${row.market}`}
                                rows={preview?.rows.slice(0, 8) ?? []}
                            />

                            {importResult && importResult.errors.length > 0 && (
                                <div className="rounded-[20px] border border-[rgba(159,58,41,0.18)] bg-[rgba(159,58,41,0.06)] p-4 text-sm leading-6 text-[#7d2c22]">
                                    {importResult.errors.join('；')}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    </Modal>
);

export const CsvImportModal = memo(CsvImportModalComponent);

CsvImportModal.displayName = 'CsvImportModal';