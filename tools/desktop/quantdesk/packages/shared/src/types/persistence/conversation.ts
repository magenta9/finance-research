import type {
    ConversationTitleSource,
    ConversationTitleStatus,
} from '../agent';

export type ConversationMessageRole =
    | 'system'
    | 'user'
    | 'assistant'
    | 'tool_call'
    | 'tool_result'
    | 'summary';

export interface ConversationMessage {
    id?: string;
    role: ConversationMessageRole;
    content: string;
    timestamp?: string;
    toolCallId?: string;
    toolCalls?: Array<Record<string, unknown>>;
    metadata?: Record<string, unknown>;
}

export interface AgentConversationInput {
    id: string;
    title: string | null;
    titleSource?: ConversationTitleSource;
    titleStatus?: ConversationTitleStatus;
    titleUpdatedAt?: string | null;
    messages: ConversationMessage[];
    context: Record<string, unknown>;
    status?: 'running' | 'waiting' | 'cancelled' | 'idle';
}

export interface AgentConversationRecord extends AgentConversationInput {
    createdAt: string;
    titleSource: ConversationTitleSource;
    titleStatus: ConversationTitleStatus;
    titleUpdatedAt: string | null;
    updatedAt: string;
}