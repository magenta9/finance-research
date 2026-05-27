import type {
    ConversationTitleSource,
    ConversationTitleStatus,
} from './types/agent';

export const defaultConversationTitleSource: ConversationTitleSource = 'placeholder';
export const defaultConversationTitleStatus: ConversationTitleStatus = 'ready';

const collapseWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();

export const computePlaceholderConversationTitle = (value: string) => {
    const normalized = collapseWhitespace(value);
    return normalized.length > 0 ? normalized.slice(0, 48) : null;
};

export const normalizeGeneratedConversationTitle = (value: string) => {
    const normalized = collapseWhitespace(
        value
            .split(/\r?\n/, 1)[0] ?? '',
    )
        .replace(/^["'“”‘’《》「」『』【】]+/, '')
        .replace(/["'“”‘’《》「」『』【】]+$/, '')
        .replace(/[。！？!?；;，,：:]+$/g, '');

    return normalized.length > 0 ? normalized.slice(0, 24) : null;
};

export const buildConversationTitleState = ({
    title,
    titleSource = defaultConversationTitleSource,
    titleStatus = defaultConversationTitleStatus,
    titleUpdatedAt = null,
}: {
    title: string | null;
    titleSource?: ConversationTitleSource;
    titleStatus?: ConversationTitleStatus;
    titleUpdatedAt?: string | null;
}) => ({
    title,
    titleSource,
    titleStatus,
    titleUpdatedAt,
});