import type { ResearcherOutput } from '@quantdesk/shared';

import type { PiRuntimeStatus, PiSendMessageInput, PiSendMessageResult, PiStreamEvent, PiToolInvocation, PiWrapperSessionTranscript } from '../pi/types';
import type { ResearchExecutor, ResearchExecutorInput } from './executor';
import { repairResearcherOutput } from './research-output-repair';

export class UnauthorizedResearchToolError extends Error {
    readonly allowedToolNames: string[];

    readonly attemptedToolName: string;

    readonly reasonCode = 'unauthorized_tool' as const;

    readonly remediation: string;

    readonly requestId: string;

    readonly role: ResearcherOutput['role'];

    readonly runId: string | null;

    readonly sessionId: string | null;

    constructor(input: {
        allowedToolNames: string[];
        attemptedToolName: string;
        requestId: string;
        role: ResearcherOutput['role'];
        runId: string | null;
        sessionId: string | null;
    }) {
        super(`Pi researcher attempted unauthorized tool: ${input.attemptedToolName}`);
        this.name = 'UnauthorizedResearchToolError';
        this.allowedToolNames = input.allowedToolNames;
        this.attemptedToolName = input.attemptedToolName;
        this.remediation = `Update the ${input.role} prompt/tool policy or rerun with one of the allowed tools: ${input.allowedToolNames.join(', ') || 'none'}.`;
        this.requestId = input.requestId;
        this.role = input.role;
        this.runId = input.runId;
        this.sessionId = input.sessionId;
    }
}

export interface PiResearchRuntime {
    cancelRun?: (runId: string, sessionId: string) => Promise<{ cancelled: boolean }>;
    ensureReady: () => Promise<void>;
    getStatus?: () => Promise<PiRuntimeStatus>;
    listToolInvocations?: (sessionId: string) => Promise<PiToolInvocation[]>;
    sendMessage: (input: PiSendMessageInput) => Promise<PiSendMessageResult>;
    subscribe: (listener: (event: PiStreamEvent) => void) => () => void;
}

export interface CreatePiResearchExecutorOptions {
    piRuntime: PiResearchRuntime;
    timeoutMs?: number;
    unauthorizedToolIdleWaitMs?: number;
}

const defaultTimeoutMs = 120_000;
const defaultUnauthorizedToolIdleWaitMs = 1_500;

const extractJsonObject = (content: string) => {
    const trimmed = content.trim();

    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        return trimmed;
    }

    const fencedMatch = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(trimmed);

    if (fencedMatch?.[1]?.trim().startsWith('{')) {
        return fencedMatch[1].trim();
    }

    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');

    if (firstBrace >= 0 && lastBrace > firstBrace) {
        return trimmed.slice(firstBrace, lastBrace + 1);
    }

    throw new Error('Pi researcher response did not contain a JSON object.');
};

const latestAssistantContent = (transcript: PiWrapperSessionTranscript) => {
    const message = [...transcript.messages]
        .reverse()
        .find((entry) => entry.role === 'assistant' && entry.phase !== 'thinking' && !entry.isError && entry.content.trim().length > 0);

    if (!message) {
        throw new Error('Pi researcher completed without an assistant response.');
    }

    return message.content;
};

export const parsePiResearcherOutput = (transcript: PiWrapperSessionTranscript, requestId: string, role: ResearcherOutput['role']): ResearcherOutput => {
    const parsed = JSON.parse(extractJsonObject(latestAssistantContent(transcript))) as unknown;

    return repairResearcherOutput(parsed, requestId, role);
};

const enforcePiOutputEvidence = (output: ResearcherOutput): ResearcherOutput => {
    if (output.dataProvenance.length > 0) {
        return output;
    }

    return {
        ...output,
        confidence: 'low',
        dataGaps: Array.from(new Set([
            ...output.dataGaps,
            'Pi researcher output did not include verifiable data provenance.',
        ])),
        needsSecondReview: true,
    };
};

const buildPiResearcherMessage = ({
    context,
    prompt,
    query,
    requestId,
    role,
}: ResearchExecutorInput) => [
    prompt.prompt,
    '',
    'You are running inside QuantDesk Pi Agent as a real research worker.',
    'Use the available QuantDesk finance tools when evidence is needed. Do not invent market data, fundamentals, news, macro data, flow, sentiment, prices, probabilities, or position sizes.',
    'If a data source or tool is unavailable, report that limitation in dataGaps and lower confidence.',
    `User query: ${query}`,
    `Research request id: ${requestId}`,
    `Research role: ${role}`,
    `Assets in current context: ${context.assets.map((asset) => `${asset.symbol}/${asset.market}`).join(', ') || 'none'}`,
    `Cached price signals: ${context.priceSignals.map((signal) => `${signal.symbol} latest=${signal.latestClose ?? 'n/a'} date=${signal.latestDate ?? 'n/a'}`).join('; ') || 'none'}`,
    '',
    'Return only one JSON object. No markdown, no prose before or after the JSON.',
    'Required JSON fields:',
    '- requestId, role, conclusion, confidence, direction, timeHorizon',
    '- actionRecommendation, edgeStrength, edgeTypes, winRateGrade, payoffGrade',
    '- evidence, assumptions, risks, dataGaps, dataProvenance, invalidationConditions, needsSecondReview',
    'Allowed enum values:',
    '- confidence: low | medium | high',
    '- direction: bullish | bearish | neutral | mixed',
    '- actionRecommendation: avoid | observe | prepare | suggested_operation | trading_plan',
    '- grade fields: unknown | none | weak | medium | strong',
    '- edgeTypes: win_rate | payoff | risk_adjusted | diversification | execution | information',
    `Set requestId exactly to ${JSON.stringify(requestId)} and role exactly to ${JSON.stringify(role)}.`,
].join('\n');

const isTerminalEventForRun = (
    event: PiStreamEvent,
    run: PiSendMessageResult,
): event is Extract<PiStreamEvent, { type: 'run_completed' | 'run_failed' | 'run_cancelled' }> => (
    (event.type === 'run_completed' || event.type === 'run_failed' || event.type === 'run_cancelled')
    && event.runId === run.runId
    && event.sessionId === run.sessionId
);

const isToolEventForRun = (
    event: PiStreamEvent,
    run: PiSendMessageResult,
): event is Extract<PiStreamEvent, { type: 'tool_execution_start' | 'tool_execution_update' | 'tool_execution_end' }> => (
    (event.type === 'tool_execution_start' || event.type === 'tool_execution_update' || event.type === 'tool_execution_end')
    && event.runId === run.runId
    && event.sessionId === run.sessionId
);

const isAllowedResearchTool = (toolName: string, allowedToolNames: string[]) => allowedToolNames.includes(toolName);

export const createPiResearchExecutor = ({
    piRuntime,
    timeoutMs = defaultTimeoutMs,
    unauthorizedToolIdleWaitMs = defaultUnauthorizedToolIdleWaitMs,
}: CreatePiResearchExecutorOptions): ResearchExecutor => ({
    runtimeMode: 'pi',
    async runResearcher(input) {
        input.signal?.throwIfAborted();

        let activeRun: PiSendMessageResult | null = null;

        return await new Promise<ResearcherOutput>((resolve, reject) => {
            const pendingEvents: PiStreamEvent[] = [];
            let settled = false;
            let timeout: NodeJS.Timeout | null = null;
            let unauthorizedToolError: Error | null = null;
            let unauthorizedToolIdleTimeout: NodeJS.Timeout | null = null;
            let unsubscribe: (() => void) | null = null;

            const settle = (callback: () => void) => {
                if (settled) {
                    return;
                }

                settled = true;
                if (timeout) {
                    clearTimeout(timeout);
                }
                if (unauthorizedToolIdleTimeout) {
                    clearTimeout(unauthorizedToolIdleTimeout);
                }
                unsubscribe?.();
                input.signal?.removeEventListener('abort', handleAbort);
                callback();
            };

            const cancelActiveRun = () => {
                if (activeRun && piRuntime.cancelRun) {
                    void piRuntime.cancelRun(activeRun.runId, activeRun.sessionId).catch((error: unknown) => {
                        void (error instanceof Error ? error.message : String(error));
                    });
                }
            };

            const cancelRun = (run: PiSendMessageResult) => {
                if (piRuntime.cancelRun) {
                    void piRuntime.cancelRun(run.runId, run.sessionId).catch((error: unknown) => {
                        void (error instanceof Error ? error.message : String(error));
                    });
                }
            };

            const waitForUnauthorizedToolTerminal = (error: Error) => {
                if (unauthorizedToolError) {
                    return;
                }

                unauthorizedToolError = error;
                cancelActiveRun();
                unauthorizedToolIdleTimeout = setTimeout(() => {
                    settle(() => reject(error));
                }, unauthorizedToolIdleWaitMs);
            };

            const handleAbort = () => {
                cancelActiveRun();
                settle(() => reject(input.signal?.reason instanceof Error ? input.signal.reason : new Error('Pi research run was aborted.')));
            };

            timeout = setTimeout(() => {
                cancelActiveRun();
                settle(() => reject(new Error(`Pi research run timed out after ${timeoutMs}ms.`)));
            }, timeoutMs);

            input.signal?.addEventListener('abort', handleAbort, { once: true });

            const handleStreamEvent = (event: PiStreamEvent) => {
                if (!activeRun) {
                    pendingEvents.push(event);
                    return;
                }

                if (unauthorizedToolError) {
                    if (isTerminalEventForRun(event, activeRun)) {
                        settle(() => reject(unauthorizedToolError));
                    }

                    return;
                }

                if (isToolEventForRun(event, activeRun)) {
                    if (!isAllowedResearchTool(event.toolName, input.prompt.allowedToolNames)) {
                        waitForUnauthorizedToolTerminal(new UnauthorizedResearchToolError({
                            allowedToolNames: input.prompt.allowedToolNames,
                            attemptedToolName: event.toolName,
                            requestId: input.requestId,
                            role: input.role,
                            runId: event.runId,
                            sessionId: event.sessionId,
                        }));
                        return;
                    }

                    if (event.type === 'tool_execution_start') {
                        input.onRuntimeEvent?.({
                            args: event.args,
                            requestId: input.requestId,
                            role: input.role,
                            runId: event.runId,
                            sessionId: event.sessionId,
                            timestamp: event.timestamp,
                            toolCallId: event.toolCallId,
                            toolName: event.toolName,
                            type: 'research_tool_started',
                        });
                        return;
                    }

                    if (event.type === 'tool_execution_update') {
                        input.onRuntimeEvent?.({
                            args: event.args,
                            partialResult: event.partialResult,
                            requestId: input.requestId,
                            role: input.role,
                            runId: event.runId,
                            sessionId: event.sessionId,
                            timestamp: event.timestamp,
                            toolCallId: event.toolCallId,
                            toolName: event.toolName,
                            type: 'research_tool_updated',
                        });
                        return;
                    }

                    input.onRuntimeEvent?.({
                        args: event.args,
                        errorCode: event.errorCode,
                        errorMessage: event.errorMessage,
                        isError: event.isError,
                        requestId: input.requestId,
                        result: event.result,
                        role: input.role,
                        runId: event.runId,
                        sessionId: event.sessionId,
                        timestamp: event.timestamp,
                        toolCallId: event.toolCallId,
                        toolName: event.toolName,
                        type: 'research_tool_completed',
                    });
                    return;
                }

                if (!isTerminalEventForRun(event, activeRun)) {
                    return;
                }

                if (event.type === 'run_completed') {
                    settle(() => {
                        try {
                            resolve(enforcePiOutputEvidence(parsePiResearcherOutput(event.transcript, input.requestId, input.role)));
                        } catch (error) {
                            reject(error);
                        }
                    });
                    return;
                }

                if (event.type === 'run_cancelled') {
                    settle(() => reject(new Error('Pi research run was cancelled.')));
                    return;
                }

                settle(() => reject(new Error(event.error)));
            };

            unsubscribe = piRuntime.subscribe(handleStreamEvent);

            piRuntime.sendMessage({
                allowedToolNames: input.prompt.allowedToolNames,
                message: buildPiResearcherMessage(input),
                startNewSession: true,
            })
                .then((run) => {
                    if (settled || input.signal?.aborted) {
                        cancelRun(run);
                        return;
                    }

                    activeRun = run;
                    for (const event of pendingEvents.splice(0)) {
                        handleStreamEvent(event);
                    }
                })
                .catch((error: unknown) => {
                    settle(() => reject(error instanceof Error ? error : new Error(String(error))));
                });
        });
    },
});