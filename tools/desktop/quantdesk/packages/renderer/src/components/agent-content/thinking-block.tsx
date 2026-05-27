import { useState } from 'react';

import type { ThinkingBlock as ThinkingBlockType } from '@quantdesk/shared';

import { Button } from '../button';
import { useContentBlockCollapseState } from './use-content-block-collapse-state';

export const AgentThinkingBlock = ({ block, threadId }: { block: ThinkingBlockType; threadId: string }) => {
    const { isOpen, toggle } = useContentBlockCollapseState({
        blockId: block.id,
        defaultOpen: block.status === 'streaming',
        threadId,
    });
    const [showFullContent, setShowFullContent] = useState(false);
    const lines = block.content.split(/\r?\n/);
    const shouldTruncate = lines.length > 500 && !showFullContent;
    const visibleContent = shouldTruncate ? lines.slice(0, 500).join('\n') : block.content;
    const summary = block.summary ?? lines[0] ?? '思考过程';

    return (
        <section className="pi-work-row" data-testid={`content-block-${block.id}`}>
            <Button aria-expanded={isOpen} className="pi-work-row-button !h-auto !border-transparent !bg-transparent !p-1 !font-normal !shadow-none active:!scale-100" onClick={toggle} size="sm" tone="ghost" type="button">
                <span aria-hidden="true" className="pi-work-row-marker pi-work-row-marker-thinking" />
                <span className="min-w-0 flex-1 truncate text-left text-xs leading-5">
                    <span className="font-medium text-[var(--color-foreground)]">Thinking</span>
                    <span className="text-[var(--color-muted)]" aria-hidden="true">{' - '}</span>
                    <span className="text-[var(--color-muted)]">{summary || '思考中'}</span>
                </span>
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-muted)]">{block.status === 'streaming' ? '思考中' : '思考完成'}</span>
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-muted)]">{isOpen ? '收起' : '展开'}</span>
            </Button>

            {isOpen && (
                <div className="pi-work-row-detail">
                    <pre className="whitespace-pre-wrap break-words text-sm leading-6 text-[var(--color-copy)]">{visibleContent}</pre>
                    {shouldTruncate && (
                        <Button className="mt-3" onClick={() => { setShowFullContent(true); }} size="sm" tone="ghost" type="button">
                            显示完整思考
                        </Button>
                    )}
                </div>
            )}
        </section>
    );
};