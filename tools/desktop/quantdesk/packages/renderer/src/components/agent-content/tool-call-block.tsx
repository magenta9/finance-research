import type { ToolCallBlock as ToolCallBlockType } from '@quantdesk/shared';

import { Button } from '../button';
import { DeferredRender } from '../deferred-render';
import { useContentBlockCollapseState } from './use-content-block-collapse-state';

const statusLabelMap: Record<ToolCallBlockType['status'], string> = {
    approved: '已批准',
    cancelled: '已取消',
    complete: '完成',
    error: '失败',
    pending: '等待',
    rejected: '已拒绝',
    requires_approval: '待确认',
    running: '进行中',
};

const looksLikeStructuredDump = (value: string) => {
    const trimmed = value.trim();

    if (!trimmed) {
        return false;
    }

    return (trimmed.startsWith('{') && trimmed.includes('"'))
        || (trimmed.startsWith('[') && trimmed.includes(']'))
        || (trimmed.length > 120 && /[{}[\]"]/.test(trimmed));
};

const getCompactToolBlockPreview = (block: ToolCallBlockType) => {
    const errorMessage = block.errorMessage?.trim();

    if ((block.status === 'error' || block.status === 'rejected') && errorMessage && !looksLikeStructuredDump(errorMessage)) {
        return errorMessage;
    }

    const summary = block.output?.summary?.trim();

    if (summary && !looksLikeStructuredDump(summary)) {
        return summary;
    }

    if (block.status === 'running') {
        return '工具执行中';
    }

    if (block.status === 'error' || block.status === 'rejected') {
        return '工具执行失败';
    }

    return '点击展开查看输入输出';
};

const isSafeStructuredImageUrl = (value: string) => {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'blob:';
    } catch (error) {
        if (error instanceof TypeError) {
            return false;
        }

        throw error;
    }
};

const renderStructuredOutput = (block: ToolCallBlockType) => {
    const structured = block.output?.structured;

    if (!structured) {
        return null;
    }

    if (structured.type === 'terminal') {
        return (
            <pre className="overflow-x-auto rounded-[12px] bg-[#2b2119] p-3 text-xs leading-6 text-[#f7efe3]">
                {structured.lines.map((line) => line.text).join('\n')}
            </pre>
        );
    }

    if (structured.type === 'diff') {
        return (
            <div className="space-y-2">
                {structured.files.map((file) => (
                    <article className="rounded-[12px] border border-[rgba(120,86,60,0.12)] bg-[rgba(255,255,255,0.68)] p-3" key={file.path}>
                        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--color-muted)]">{file.path}</p>
                        {file.patch && <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs leading-6 text-[var(--color-copy)]">{file.patch}</pre>}
                    </article>
                ))}
            </div>
        );
    }

    if (structured.type === 'search_results') {
        return (
            <div className="space-y-2">
                {structured.results.map((result) => (
                    <article className="rounded-[12px] border border-[rgba(120,86,60,0.12)] bg-[rgba(255,255,255,0.68)] p-3" key={`${result.path}-${result.title ?? ''}`}>
                        <p className="font-medium text-[var(--color-foreground)]">{result.title ?? result.path}</p>
                        {result.snippet && <p className="mt-1 text-xs leading-5 text-[var(--color-copy)]">{result.snippet}</p>}
                    </article>
                ))}
            </div>
        );
    }

    if (!isSafeStructuredImageUrl(structured.url)) {
        return <p className="text-xs leading-5 text-[var(--color-muted)]">图片地址不可预览</p>;
    }

    return (
        <figure className="overflow-hidden rounded-[14px] border border-[rgba(120,86,60,0.12)] bg-[rgba(255,255,255,0.68)] p-3">
            <img alt={structured.alt ?? block.toolLabel} className="max-h-[320px] w-full rounded-[10px] object-cover" src={structured.url} />
            {structured.alt && <figcaption className="mt-2 text-xs leading-5 text-[var(--color-copy)]">{structured.alt}</figcaption>}
        </figure>
    );
};

export const AgentToolCallBlock = ({ block, threadId }: { block: ToolCallBlockType; threadId: string }) => {
    const isActiveProcessingState = block.status === 'pending'
        || block.status === 'approved'
        || block.status === 'requires_approval'
        || block.status === 'running';

    const { isOpen, toggle } = useContentBlockCollapseState({
        blockId: block.id,
        defaultOpen: isActiveProcessingState,
        threadId,
    });
    const outputContent = block.output?.content ?? null;
    const shouldDeferOutput = Boolean(outputContent && outputContent.length > 1_500);
    const structuredOutput = renderStructuredOutput(block);
    const preview = getCompactToolBlockPreview(block);

    const content = (
        <section className="pi-work-row" data-testid={`content-block-${block.id}`}>
            <Button aria-expanded={isOpen} className="pi-work-row-button !h-auto !border-transparent !bg-transparent !p-1 !font-normal !shadow-none active:!scale-100" onClick={toggle} size="sm" tone="ghost" type="button">
                <span aria-hidden="true" className={`pi-work-row-marker ${block.status === 'error' || block.status === 'rejected' ? 'pi-work-row-marker-error' : 'pi-work-row-marker-tool'}`} />
                <span className="min-w-0 flex-1 truncate text-left text-xs leading-5">
                    <span className="font-medium text-[var(--color-foreground)]">{block.toolLabel}</span>
                    <span className="text-[var(--color-muted)]" aria-hidden="true">{' - '}</span>
                    <span className="text-[var(--color-muted)]">{preview}</span>
                </span>
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-muted)]">{statusLabelMap[block.status]}</span>
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-muted)]">{isOpen ? '收起' : '展开'}</span>
            </Button>

            {isOpen && (
                <div className="pi-work-row-detail space-y-3">
                    <div>
                        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-muted)]">Input</p>
                        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg bg-[rgba(61,43,31,0.06)] p-3 text-xs leading-6 text-[var(--color-copy)]">{JSON.stringify(block.input, null, 2)}</pre>
                    </div>

                    {(block.output || block.errorMessage) && (
                        <div>
                            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-muted)]">Output</p>
                            {block.errorMessage && <p className="mt-2 text-sm leading-6 text-[#7d2c22]">{block.errorMessage}</p>}
                            {block.status === 'running' && outputContent && (
                                <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-muted)]">中间结果</p>
                            )}
                            {outputContent && <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg bg-[rgba(255,255,255,0.58)] p-3 text-xs leading-6 text-[var(--color-copy)]">{outputContent}</pre>}
                            {structuredOutput && <div className="mt-3">{structuredOutput}</div>}
                        </div>
                    )}
                </div>
            )}
        </section>
    );

    if (!shouldDeferOutput) {
        return content;
    }

    return (
        <DeferredRender fallbackLabel="工具输出即将渲染">
            {content}
        </DeferredRender>
    );
};