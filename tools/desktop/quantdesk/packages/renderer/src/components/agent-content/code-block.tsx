import type { CodeBlock as CodeBlockType } from '@quantdesk/shared';

import { DeferredRender } from '../deferred-render';

export const AgentCodeBlock = ({ block }: { block: CodeBlockType }) => {
    const content = (
        <section className="rounded-[18px] border border-[rgba(120,86,60,0.12)] bg-[#2b2119] text-[#f7efe3]" data-testid={`content-block-${block.id}`}>
            <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.08)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[rgba(255,255,255,0.58)]">
                <span>{block.filename ?? block.language ?? 'code'}</span>
                {block.language && <span>{block.language}</span>}
            </div>
            <pre className="overflow-x-auto p-4 text-sm leading-6"><code>{block.content}</code></pre>
        </section>
    );

    if (block.content.length < 1_500) {
        return content;
    }

    return (
        <DeferredRender fallbackLabel="代码块即将渲染">
            {content}
        </DeferredRender>
    );
};