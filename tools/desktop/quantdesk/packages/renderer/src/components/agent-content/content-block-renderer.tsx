import type { ContentBlock } from '@quantdesk/shared';

import { AgentCodeBlock } from './code-block';
import { AgentErrorBlock } from './error-block';
import { AgentTextBlock } from './text-block';
import { AgentThinkingBlock } from './thinking-block';
import { AgentToolCallBlock } from './tool-call-block';

export const ContentBlockRenderer = ({ block, threadId }: { block: ContentBlock; threadId: string }) => {
    if (block.type === 'thinking') {
        return <AgentThinkingBlock block={block} threadId={threadId} />;
    }

    if (block.type === 'tool_call') {
        return <AgentToolCallBlock block={block} threadId={threadId} />;
    }

    if (block.type === 'code') {
        return <AgentCodeBlock block={block} />;
    }

    if (block.type === 'error') {
        return <AgentErrorBlock block={block} />;
    }

    return <AgentTextBlock block={block} />;
};