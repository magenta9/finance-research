import type {
    AllocationConstraints,
    AllocationResult,
    AllocationType,
    Currency,
} from './domain';
import type {
    AgentConversationRecord,
    ConversationMessage,
    StoredAsset,
} from './persistence';
import type {
    AssistantContentProjection,
    NormalizedStreamEvent,
} from './agent-content-block';

export type LlmProviderType = 'ollama' | 'openai-compatible';

export type JsonSchema = Record<string, unknown>;

export type AgentRunState = 'running' | 'waiting' | 'cancelled' | 'idle';

export type ConversationTitleSource = 'placeholder' | 'generated' | 'upstream';

export type ConversationTitleStatus = 'pending' | 'ready' | 'failed';

export type SchedulerPriority = 'interactive_chat' | 'summarizer' | 'embedding_batch';

export type ToolVisibility = 'always' | 'contextual';

export interface ToolCall {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}

export interface ToolExecutionError {
    code: string;
    message: string;
    stack?: string;
}

export interface ToolProvenance {
    inputSnapshot: unknown;
    outputSnapshot: unknown;
    durationMs: number;
    tokenCount: number;
    error?: ToolExecutionError;
}

export interface ToolResult {
    toolCallId: string;
    name: string;
    content: string;
    isError?: boolean;
    truncated?: boolean;
    provenance?: ToolProvenance;
}

export interface ToolSchema {
    name: string;
    description: string;
    parameters: JsonSchema;
    visibility?: ToolVisibility;
}

export interface ProviderCapabilities {
    toolCalling: boolean;
    embedding: boolean;
    streaming: boolean;
    contextWindow: number | null;
}

export interface RunStatus {
    conversationId: string;
    runId?: string;
    state: AgentRunState;
    currentTool?: string;
    queuePosition?: number;
    providerId?: string;
    model?: string;
}

export interface ToolExecutionRecord {
    id: string;
    conversationId: string;
    messageId: string;
    toolCallId?: string | null;
    runId?: string | null;
    toolName: string;
    input: unknown;
    output: unknown;
    summary?: string | null;
    error?: ToolExecutionError;
    status: 'running' | 'success' | 'error' | 'timeout' | 'cancelled';
    durationMs: number | null;
    tokenCount: number | null;
    createdAt: string;
    finishedAt?: string | null;
}

export interface ConversationTitleMetadata {
    titleSource: ConversationTitleSource;
    titleStatus: ConversationTitleStatus;
    titleUpdatedAt: string | null;
}

export interface CompactionSnapshot {
    id: string;
    conversationId: string;
    summaryText: string;
    coveredMessageIds: string[];
    tokenEstimate: number | null;
    createdAt: string;
}

export interface SchedulerStats {
    inflight: number;
    queueDepthByLane: Record<SchedulerPriority, number>;
    recentWaitMsP50P95: {
        p50: number;
        p95: number;
    };
    dropCountsByLane: Record<SchedulerPriority, number>;
}

export interface RagIndexError {
    id: number;
    docPath: string;
    occurredAt: string;
    stage: string;
    code: string;
    message: string;
}

export interface RagStatus {
    available: boolean;
    docsRoot: string | null;
    embeddingModel: string | null;
    indexing: boolean;
    lastIndexedAt: string | null;
    runtimeMode?: 'electron' | 'browser-live';
    totalChunks: number;
    totalDocs: number;
    errors: RagIndexError[];
}

export interface LlmProviderConfig {
    id: string;
    name: string;
    type: LlmProviderType;
    baseUrl: string;
    model: string;
    apiKeyAccount?: string;
    enabled: boolean;
    toolCalling?: boolean;
    embeddingModel?: string | null;
    contextWindow?: number | null;
}

export interface AgentConversationSummary extends ConversationTitleMetadata {
    id: string;
    title: string | null;
    updatedAt: string;
    status?: AgentRunState;
    lastToolName?: string | null;
}

export type ToolHistoryAvailability = 'available' | 'loading' | 'unavailable';

export interface AgentConversationToolStep {
    errorMessage: string | null;
    executionId: string | null;
    finishedAt: string | null;
    id: string;
    input: unknown;
    output: unknown;
    runId: string | null;
    source: 'history' | 'live';
    startedAt: string;
    status: ToolExecutionRecord['status'];
    summary: string | null;
    toolCallId: string | null;
    toolName: string;
}

export interface AgentConversationTurn {
    id: string;
    message: ConversationMessage;
    replayUnavailable: boolean;
    steps: AgentConversationToolStep[];
    summaryLabel: string | null;
}

export interface AgentConversationProjection extends ConversationTitleMetadata, AssistantContentProjection {
    activitySummary: {
        failedSteps: number;
        replayUnavailableTurns: number;
        runningSteps: number;
        totalSteps: number;
    };
    assistantTurns: AgentConversationTurn[];
    conversationId: string;
    status: RunStatus['state'];
    title: string | null;
    toolHistoryAvailability: ToolHistoryAvailability;
    visibleMessages: ConversationMessage[];
}

export interface AgentConversationProjectionDelta {
    conversationId: string;
    projection: AgentConversationProjection;
    runId?: string;
    sourceType: AgentStreamChunkEvent['type'];
    timestamp: string;
}

export interface AgentProviderState {
    defaultProviderId: string;
    providers: LlmProviderConfig[];
}

export interface AgentProviderUpdateInput {
    provider: LlmProviderConfig;
    apiKey?: string | null;
    clearApiKey?: boolean;
}

export interface AgentRichBlock {
    type: 'text' | 'table' | 'metric-grid' | 'chart' | 'citations';
    title: string;
    data: Record<string, unknown>;
}

export interface AgentStreamChunkEvent {
    type:
    | 'run_started'
    | 'text_delta'
    | 'tool_call_start'
    | 'tool_call_end'
    | 'tool_result'
    | 'compaction_triggered'
    | 'conversation_updated'
    | 'run_completed'
    | 'run_cancelled'
    | 'run_status';
    runId: string;
    conversationId: string;
    timestamp: string;
    chunk?: string;
    chunkIndex?: number;
    done?: boolean;
    error?: string;
    providerId?: string;
    skill?: string | null;
    status?: RunStatus;
    toolCall?: ToolCall;
    toolResult?: ToolResult;
    toolExecution?: ToolExecutionRecord;
    conversation?: AgentConversationRecord | null;
    summarySnapshot?: CompactionSnapshot;
    normalizedEvents?: NormalizedStreamEvent[];
}

export interface AgentStartRunRequest {
    conversationId?: string;
    message: string;
    activePlanId?: string;
    providerId?: string;
}

export interface AgentStartRunResponse {
    conversationId: string;
    runId: string;
    status: RunStatus;
}

export interface AgentSkillContext {
    assets: StoredAsset[];
    latestAllocation: AllocationResult | null;
    latestPlanId?: string;
    baseCurrency: Currency;
}

export interface AllocationIntent {
    mode: AllocationType;
    symbols: string[];
    constraints: Partial<AllocationConstraints>;
}

export interface LlmChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    name?: string;
    toolCallId?: string;
    toolCalls?: ToolCall[];
}