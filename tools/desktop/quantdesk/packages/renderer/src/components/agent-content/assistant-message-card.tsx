import type { AgentConversationToolStep, AssistantMessage, ToolHistoryAvailability } from '@quantdesk/shared';

import { ToolActivitySteps } from '../agent/tool-activity-steps';
import { Button } from '../button';
import { ContentBlockRenderer } from './content-block-renderer';

export const AssistantMessageCard = ({
    activityEvidence,
    assistantMessage,
    onStop,
    threadId,
}: {
    activityEvidence?: {
        metadata?: string[];
        replayUnavailable: boolean;
        steps: AgentConversationToolStep[];
        summaryLabel: string | null;
        toolHistoryAvailability: ToolHistoryAvailability;
        turnId: string;
    };
    assistantMessage: AssistantMessage;
    onStop?: (assistantMessage: AssistantMessage) => void;
    threadId: string;
}) => {
    const showFooter = Boolean(
        (assistantMessage.status === 'streaming' && onStop)
        || (assistantMessage.replayUnavailable && !activityEvidence),
    );

    return (
        <article className="group/assistant min-w-0 px-1 py-0.5" data-testid={`assistant-message-${assistantMessage.id}`}>
            <div className="min-w-0">
                {assistantMessage.blocks.length > 0 ? (
                    assistantMessage.blocks.map((block) => (
                        <ContentBlockRenderer block={block} key={block.id} threadId={threadId} />
                    ))
                ) : (
                    <section className="text-sm leading-6 text-[var(--color-copy)]">
                        等待输出...
                    </section>
                )}
            </div>

            {activityEvidence && (
                <ToolActivitySteps
                    metadata={activityEvidence.metadata}
                    replayUnavailable={activityEvidence.replayUnavailable}
                    steps={activityEvidence.steps}
                    summaryLabel={activityEvidence.summaryLabel}
                    toolHistoryAvailability={activityEvidence.toolHistoryAvailability}
                    turnId={activityEvidence.turnId}
                />
            )}

            {showFooter && (
                <footer className="mt-1.5 flex flex-wrap items-center justify-end gap-2">
                    <div className="flex flex-wrap items-center gap-2 opacity-100 transition-opacity duration-150 sm:opacity-0 sm:group-hover/assistant:opacity-100 sm:focus-within:opacity-100">
                        {assistantMessage.status === 'streaming' && onStop && (
                            <Button onClick={() => { onStop(assistantMessage); }} size="sm" tone="danger" type="button">
                                停止生成
                            </Button>
                        )}
                        {assistantMessage.replayUnavailable && !activityEvidence && (
                            <span className="text-xs leading-5 text-[var(--color-muted)]">历史步骤不可完整回放</span>
                        )}
                    </div>
                </footer>
            )}
        </article>
    );
};