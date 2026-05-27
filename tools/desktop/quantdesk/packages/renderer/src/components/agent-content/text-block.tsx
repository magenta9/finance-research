import type { ReactNode } from 'react';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type { TextBlock as TextBlockType } from '@quantdesk/shared';

import { AgentRichBlocks } from '../agent/rich-blocks';

const markdownComponents = {
    blockquote: ({ children }: { children?: ReactNode }) => <blockquote>{children}</blockquote>,
    code: ({ children }: { children?: ReactNode }) => <code>{children}</code>,
    ol: ({ children }: { children?: ReactNode }) => <ol>{children}</ol>,
    p: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
    strong: ({ children }: { children?: ReactNode }) => <strong>{children}</strong>,
    ul: ({ children }: { children?: ReactNode }) => <ul>{children}</ul>,
};

export const AgentTextBlock = ({ block }: { block: TextBlockType }) => (
    <section aria-live={block.status === 'streaming' ? 'polite' : undefined} data-testid={`content-block-${block.id}`}>
        <div className="pi-chat-markdown">
            <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
                {block.content || '正在生成内容...'}
            </ReactMarkdown>
        </div>
        {block.richBlocks && block.richBlocks.length > 0 && (
            <div className="mt-4">
                <AgentRichBlocks blocks={block.richBlocks} />
            </div>
        )}
        {block.status === 'streaming' && (
            <div className="mt-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
                <span className="pi-working-dots" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                </span>
                正在输出
            </div>
        )}
    </section>
);