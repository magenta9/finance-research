import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, test, vi } from 'vitest';

import type { PiWrapperSessionSummary, PiWrapperSessionTranscript, PiWrapperSkillSummary } from '../types';
import { PiWrapperRuntime } from './runtime';
import type { PiWrapperToolInvocationStore } from './tool-invocation-store';

type PiRuntimeSessionStub = {
    model?: { id: string; provider: string } | null;
    prompt?: (message: string, options?: unknown) => Promise<void>;
    sessionId: string;
    sessionManager: {
        buildSessionContext?: () => { model: { modelId: string; provider: string } };
        getEntries?: () => unknown[];
    };
};

type PiWrapperRuntimeHarness = {
    emitDiagnosticsUpdated: () => Promise<void>;
    ensureRuntimeForSession: (sessionId?: string, startNewSession?: boolean) => Promise<void>;
    getAvailableModels: () => Promise<string[]>;
    getDiagnostics: PiWrapperRuntime['getDiagnostics'];
    getSessionTranscript: (sessionId: string) => Promise<PiWrapperSessionTranscript>;
    lastError: string | null;
    listSessions: () => Promise<PiWrapperSessionSummary[]>;
    listSkills: () => Promise<PiWrapperSkillSummary[]>;
    runtime: { session: PiRuntimeSessionStub } | null;
    sendMessage: PiWrapperRuntime['sendMessage'];
    toolInvocations: PiWrapperToolInvocationStore;
};

type PiWrapperRuntimePrivateHarness = PiWrapperRuntimeHarness & {
    ai: unknown;
    createCustomTools: () => Array<{
        execute: (toolCallId: string, params: unknown) => Promise<unknown>;
        name: string;
    }>;
    currentRun: {
        allowedToolNames: Set<string> | null;
        cancelRequested: boolean;
        messageId: string;
        runId: string;
        sessionId: string;
    } | null;
    sdk: unknown;
};

type PiSdkStub = {
    AuthStorage: { create: ReturnType<typeof vi.fn> };
    ModelRegistry: { create: ReturnType<typeof vi.fn> };
    SessionManager: { create: ReturnType<typeof vi.fn>; open: ReturnType<typeof vi.fn> };
    createAgentSessionFromServices: ReturnType<typeof vi.fn>;
    createAgentSessionRuntime: ReturnType<typeof vi.fn>;
    createAgentSessionServices: ReturnType<typeof vi.fn>;
    defineTool: ReturnType<typeof vi.fn>;
};

function createRuntimeHarness(options: ConstructorParameters<typeof PiWrapperRuntime>[0]) {
    return new PiWrapperRuntime(options) as unknown as PiWrapperRuntimeHarness;
}

const createPrivateRuntimeHarness = (options: ConstructorParameters<typeof PiWrapperRuntime>[0]) => (
    new PiWrapperRuntime(options) as unknown as PiWrapperRuntimePrivateHarness
);

const fakePiTypeNamespace = {
    Any: vi.fn(() => ({ type: 'any' })),
    Array: vi.fn((items) => ({ items, type: 'array' })),
    Boolean: vi.fn((options) => ({ options, type: 'boolean' })),
    Integer: vi.fn((options) => ({ options, type: 'integer' })),
    Number: vi.fn((options) => ({ options, type: 'number' })),
    Object: vi.fn((properties, options) => ({ options, properties, type: 'object' })),
    Optional: vi.fn((value) => ({ optional: true, value })),
    String: vi.fn((options) => ({ options, type: 'string' })),
};

describe('PiWrapperRuntime.getDiagnostics', () => {
    test('adds the project .agents skills directory to Agent resource loading', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quantdesk-pi-skills-'));
        const sessionDir = path.join(tempDir, 'sessions');
        const workspaceDir = path.join(tempDir, 'workspace', 'nested');
        const skillDir = path.join(tempDir, '.agents', 'skills');
        fs.mkdirSync(path.join(skillDir, 'quantdesk-research'), { recursive: true });
        fs.mkdirSync(workspaceDir, { recursive: true });
        fs.writeFileSync(path.join(skillDir, 'quantdesk-research', 'SKILL.md'), [
            '---',
            'name: quantdesk-research',
            'description: QuantDesk research skill.',
            '---',
            'Use QuantDesk data.',
        ].join('\n'));

        try {
            const runtime = createPrivateRuntimeHarness({
                directories: {
                    agentDir: path.join(tempDir, 'config'),
                    sessionDir,
                    toolInvocationDir: path.join(tempDir, 'tool-invocations'),
                    workspaceDir,
                },
                emitEvent: () => undefined,
                requestHost: vi.fn(),
            });
            const sessionManager = {
                getCwd: () => workspaceDir,
                getEntries: () => [],
                getSessionFile: () => path.join(sessionDir, 'session-1.jsonl'),
            };
            const runtimeSession = {
                bindExtensions: vi.fn(async () => undefined),
                messages: [],
                model: null,
                sessionId: 'session-1',
                sessionManager,
                subscribe: vi.fn(() => vi.fn()),
                thinkingLevel: 'off',
            };
            const sdk: PiSdkStub = {
                AuthStorage: { create: vi.fn(() => ({})) },
                ModelRegistry: { create: vi.fn(() => ({ getAvailable: vi.fn(async () => []) })) },
                SessionManager: {
                    create: vi.fn(() => sessionManager),
                    open: vi.fn(),
                },
                createAgentSessionFromServices: vi.fn(async () => ({ session: runtimeSession })),
                createAgentSessionRuntime: vi.fn(async (createRuntime, options) => {
                    const result = await createRuntime({
                        agentDir: options.agentDir,
                        cwd: options.cwd,
                        sessionManager: options.sessionManager,
                        sessionStartEvent: { reason: 'startup', type: 'session_start' },
                    });

                    return {
                        diagnostics: result.diagnostics,
                        dispose: vi.fn(async () => undefined),
                        services: result.services,
                        session: result.session,
                        switchSession: vi.fn(),
                    };
                }),
                createAgentSessionServices: vi.fn(async () => ({ diagnostics: [] })),
                defineTool: vi.fn((definition) => definition),
            };

            runtime.ai = {
                StringEnum: vi.fn((values, options) => ({ options, type: 'enum', values })),
                Type: fakePiTypeNamespace,
            };
            runtime.sdk = sdk;

            await runtime.ensureRuntimeForSession();

            expect(sdk.createAgentSessionServices).toHaveBeenCalledWith(expect.objectContaining({
                resourceLoaderOptions: expect.objectContaining({
                    additionalSkillPaths: expect.arrayContaining([skillDir]),
                }),
            }));
        } finally {
            fs.rmSync(tempDir, { force: true, recursive: true });
        }
    });

    test('lists skills from Agent resource paths', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quantdesk-pi-list-skills-'));
        const workspaceDir = path.join(tempDir, 'workspace', 'nested');
        const skillDir = path.join(tempDir, '.agent', 'skills');
        const agentsSkillDir = path.join(tempDir, '.agents', 'skills');
        const agentDir = path.join(tempDir, 'config');
        fs.mkdirSync(path.join(skillDir, 'quantdesk-research'), { recursive: true });
        fs.mkdirSync(path.join(skillDir, 'macro-scan'), { recursive: true });
        fs.mkdirSync(path.join(agentsSkillDir, 'hunt'), { recursive: true });
        fs.mkdirSync(path.join(agentDir, '.agents'), { recursive: true });
        fs.symlinkSync(agentsSkillDir, path.join(agentDir, '.agents', 'skills'));
        fs.mkdirSync(workspaceDir, { recursive: true });
        fs.writeFileSync(path.join(skillDir, 'quantdesk-research', 'SKILL.md'), [
            '---',
            'name: quantdesk-research',
            'description: QuantDesk research skill.',
            '---',
            'Use QuantDesk data.',
        ].join('\n'));
        fs.writeFileSync(path.join(skillDir, 'macro-scan', 'SKILL.md'), [
            '---',
            'name: macro-scan',
            'description: Macro scan skill.',
            '---',
            'Scan macro context.',
        ].join('\n'));
        fs.writeFileSync(path.join(agentsSkillDir, 'hunt', 'SKILL.md'), [
            '---',
            'name: hunt',
            'description: Debugging skill.',
            '---',
            'Find root causes.',
        ].join('\n'));

        try {
            const runtime = createPrivateRuntimeHarness({
                directories: {
                    agentDir,
                    sessionDir: path.join(tempDir, 'sessions'),
                    toolInvocationDir: path.join(tempDir, 'tool-invocations'),
                    workspaceDir,
                },
                emitEvent: () => undefined,
                requestHost: vi.fn(),
            });
            runtime.sdk = {};

            await expect(runtime.listSkills()).resolves.toEqual(expect.arrayContaining([
                expect.objectContaining({
                    description: 'Debugging skill.',
                    name: 'hunt',
                }),
                expect.objectContaining({
                    description: 'Macro scan skill.',
                    name: 'macro-scan',
                }),
                expect.objectContaining({
                    description: 'QuantDesk research skill.',
                    name: 'quantdesk-research',
                }),
            ]));
        } finally {
            fs.rmSync(tempDir, { force: true, recursive: true });
        }
    });

    test('lists production repo skills from configured skill paths', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quantdesk-pi-configured-skills-'));
        const workspaceDir = path.join(tempDir, 'workspace');
        const configuredSkillDir = path.join(tempDir, 'repo', '.agents', 'skills');
        const agentDir = path.join(tempDir, 'config');
        const previousSkillPaths = process.env.QUANTDESK_PI_SKILL_PATHS;
        fs.mkdirSync(path.join(configuredSkillDir, 'futures-trend-observation'), { recursive: true });
        fs.mkdirSync(agentDir, { recursive: true });
        fs.mkdirSync(workspaceDir, { recursive: true });
        fs.writeFileSync(path.join(configuredSkillDir, 'futures-trend-observation', 'SKILL.md'), [
            '---',
            'name: futures-trend-observation',
            'description: Analyze futures trend observation setups.',
            '---',
            'Use quant-data evidence.',
        ].join('\n'));
        process.env.QUANTDESK_PI_SKILL_PATHS = configuredSkillDir;

        try {
            const runtime = createPrivateRuntimeHarness({
                directories: {
                    agentDir,
                    sessionDir: path.join(tempDir, 'sessions'),
                    toolInvocationDir: path.join(tempDir, 'tool-invocations'),
                    workspaceDir,
                },
                emitEvent: () => undefined,
                requestHost: vi.fn(),
            });
            runtime.sdk = {};

            await expect(runtime.listSkills()).resolves.toContainEqual(expect.objectContaining({
                description: 'Analyze futures trend observation setups.',
                name: 'futures-trend-observation',
            }));
        } finally {
            if (previousSkillPaths === undefined) {
                delete process.env.QUANTDESK_PI_SKILL_PATHS;
            } else {
                process.env.QUANTDESK_PI_SKILL_PATHS = previousSkillPaths;
            }
            fs.rmSync(tempDir, { force: true, recursive: true });
        }
    });

    test('reports ready when the wrapper process is healthy but no session runtime has been initialized yet', async () => {
        const runtime = createRuntimeHarness({
            directories: {
                agentDir: '/tmp/quantdesk-pi-runtime-test/config',
                sessionDir: '/tmp/quantdesk-pi-runtime-test/sessions',
                toolInvocationDir: '/tmp/quantdesk-pi-runtime-test/tool-invocations',
                workspaceDir: '/tmp/quantdesk-pi-runtime-test/workspace',
            },
            emitEvent: () => undefined,
            requestHost: vi.fn(async () => ({
                payload: {
                    audit: {
                        generatedAt: '2026-04-21T00:00:00.000Z',
                        toolName: 'health_check',
                    },
                    citations: [],
                    ok: true,
                    payload: {},
                    richBlocks: [],
                    summary: 'ok',
                },
            })),
        });

        runtime.listSessions = vi.fn(async () => [{
            cwd: '/tmp/quantdesk-pi-runtime-test/workspace',
            firstMessage: 'hello',
            id: 'session-1',
            modifiedAt: '2026-04-21T00:00:00.000Z',
            name: 'Session',
            path: '/tmp/quantdesk-pi-runtime-test/sessions/session-1.jsonl',
        }]);
        runtime.getAvailableModels = vi.fn(async () => []);
        runtime.lastError = null;
        runtime.runtime = null;

        const status = await runtime.getDiagnostics();

        expect(status.pid).toBeTypeOf('number');
        expect(status.sessionCount).toBe(1);
        expect(status.state).toBe('ready');
    });

    test('falls back to the session context model when the live runtime model is not hydrated', async () => {
        const runtime = createRuntimeHarness({
            directories: {
                agentDir: '/tmp/quantdesk-pi-runtime-test/config',
                sessionDir: '/tmp/quantdesk-pi-runtime-test/sessions',
                toolInvocationDir: '/tmp/quantdesk-pi-runtime-test/tool-invocations',
                workspaceDir: '/tmp/quantdesk-pi-runtime-test/workspace',
            },
            emitEvent: () => undefined,
            requestHost: vi.fn(async () => ({
                payload: {
                    audit: {
                        generatedAt: '2026-04-21T00:00:00.000Z',
                        toolName: 'health_check',
                    },
                    citations: [],
                    ok: true,
                    payload: {},
                    richBlocks: [],
                    summary: 'ok',
                },
            })),
        });

        runtime.listSessions = vi.fn(async () => [{
            cwd: '/tmp/quantdesk-pi-runtime-test/workspace',
            firstMessage: 'hello',
            id: 'session-1',
            modifiedAt: '2026-04-21T00:00:00.000Z',
            name: 'Session',
            path: '/tmp/quantdesk-pi-runtime-test/sessions/session-1.jsonl',
        }]);
        runtime.getAvailableModels = vi.fn(async () => []);
        runtime.lastError = null;
        runtime.runtime = {
            session: {
                model: null,
                sessionId: 'session-1',
                sessionManager: {
                    buildSessionContext: vi.fn(() => ({
                        model: {
                            modelId: 'gpt-4.1-mini',
                            provider: 'github-copilot',
                        },
                    })),
                },
            },
        };

        const status = await runtime.getDiagnostics();

        expect(status.model.available).toBe(true);
        expect(status.model.model).toBe('gpt-4.1-mini');
        expect(status.model.provider).toBe('github-copilot');
    });

    test('normalizes modelId when reading an inactive session transcript', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quantdesk-pi-transcript-model-'));
        const workspaceDir = path.join(tempDir, 'workspace');
        const sessionDir = path.join(tempDir, 'sessions');
        const sessionPath = path.join(sessionDir, 'session-2.jsonl');
        const runtime = createPrivateRuntimeHarness({
            directories: {
                agentDir: path.join(tempDir, 'config'),
                sessionDir,
                toolInvocationDir: path.join(tempDir, 'tool-invocations'),
                workspaceDir,
            },
            emitEvent: () => undefined,
            requestHost: vi.fn(),
        });

        try {
            runtime.ai = {};
            runtime.sdk = {
                SessionManager: {
                    list: vi.fn(async () => [{
                        cwd: workspaceDir,
                        firstMessage: 'hello',
                        id: 'session-2',
                        modified: new Date('2026-04-21T10:00:00.000Z'),
                        path: sessionPath,
                    }]),
                    open: vi.fn(() => ({
                        buildSessionContext: vi.fn(() => ({
                            messages: [],
                            model: {
                                modelId: 'MiniMax-M2.7-highspeed',
                                provider: 'minimax-cn',
                            },
                            thinkingLevel: 'off',
                        })),
                    })),
                },
            };

            const transcript = await runtime.getSessionTranscript('session-2');

            expect(transcript.model).toEqual({
                modelId: 'MiniMax-M2.7-highspeed',
                provider: 'minimax-cn',
            });
        } finally {
            fs.rmSync(tempDir, { force: true, recursive: true });
        }
    });

    test('persists cancelled tool invocations for the aborted run', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quantdesk-pi-runtime-cancel-'));
        const runtime = createRuntimeHarness({
            directories: {
                agentDir: path.join(tempDir, 'config'),
                sessionDir: path.join(tempDir, 'sessions'),
                toolInvocationDir: path.join(tempDir, 'tool-invocations'),
                workspaceDir: path.join(tempDir, 'workspace'),
            },
            emitEvent: () => undefined,
            requestHost: vi.fn(),
        });

        try {
            runtime.toolInvocations.recordToolStart({
                args: {},
                toolCallId: 'tool-1',
                toolName: 'market.scan',
            }, { runId: 'run-1', sessionId: 'session-1' });

            runtime.toolInvocations.markRunCancelled('session-1', 'run-1', '2026-04-21T10:00:05.000Z');

            expect(runtime.toolInvocations.list('session-1')[0]).toEqual(expect.objectContaining({
                finishedAt: '2026-04-21T10:00:05.000Z',
                status: 'cancelled',
            }));
        } finally {
            fs.rmSync(tempDir, { force: true, recursive: true });
        }
    });

    test('prefers a normalized curl timeout over the generic transcript failure message', async () => {
        const emitEvent = vi.fn();
        let resolvePrompt: () => void = () => {
            throw new Error('prompt resolver missing');
        };
        const prompt = vi.fn(() => new Promise<void>((resolve) => {
            resolvePrompt = resolve;
        }));
        const runtime = createRuntimeHarness({
            directories: {
                agentDir: '/tmp/quantdesk-pi-runtime-test/config',
                sessionDir: '/tmp/quantdesk-pi-runtime-test/sessions',
                toolInvocationDir: '/tmp/quantdesk-pi-runtime-test/tool-invocations',
                workspaceDir: '/tmp/quantdesk-pi-runtime-test/workspace',
            },
            emitEvent,
            requestHost: vi.fn(),
        });

        runtime.emitDiagnosticsUpdated = vi.fn(async () => undefined);
        runtime.ensureRuntimeForSession = vi.fn(async () => undefined);
        runtime.getSessionTranscript = vi.fn(async () => ({
            cwd: '/tmp/quantdesk-pi-runtime-test/workspace',
            messages: [
                {
                    content: '(no output)\n\nCommand exited with code 28',
                    id: 'assistant-1',
                    isError: true,
                    role: 'assistant',
                },
            ],
            model: null,
            path: '/tmp/quantdesk-pi-runtime-test/sessions/session-1.jsonl',
            sessionId: 'session-1',
            thinkingLevel: 'off',
        }));
        runtime.runtime = {
            session: {
                prompt,
                sessionId: 'session-1',
                sessionManager: {
                    getEntries: () => [1],
                },
            },
        };

        const sendResult = await runtime.sendMessage({ message: 'hello pi' });
        runtime.toolInvocations.recordToolStart({
            args: {
                command: 'curl -sL --max-time 15 "https://r.jina.ai/https://en.wikipedia.org/wiki/GPT-5" 2>&1',
            },
            toolCallId: 'tool-1',
            toolName: 'bash',
        }, { runId: sendResult.runId, sessionId: 'session-1' });
        runtime.toolInvocations.recordToolEnd({
            isError: true,
            result: {
                content: [{ type: 'text', text: '(no output)\n\nCommand exited with code 28' }],
            },
            toolCallId: 'tool-1',
        }, { runId: sendResult.runId, sessionId: 'session-1' });
        resolvePrompt();

        await vi.waitFor(() => {
            expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({
                error: 'curl request timed out while fetching r.jina.ai (exit code 28).',
                type: 'run_failed',
            }));
        });
    });

    test('completes a run when an earlier tool failed but the final assistant message succeeded', async () => {
        const emitEvent = vi.fn();
        let resolvePrompt: () => void = () => {
            throw new Error('prompt resolver missing');
        };
        const prompt = vi.fn(() => new Promise<void>((resolve) => {
            resolvePrompt = resolve;
        }));
        const runtime = createRuntimeHarness({
            directories: {
                agentDir: '/tmp/quantdesk-pi-runtime-test/config',
                sessionDir: '/tmp/quantdesk-pi-runtime-test/sessions',
                toolInvocationDir: '/tmp/quantdesk-pi-runtime-test/tool-invocations',
                workspaceDir: '/tmp/quantdesk-pi-runtime-test/workspace',
            },
            emitEvent,
            requestHost: vi.fn(),
        });

        runtime.emitDiagnosticsUpdated = vi.fn(async () => undefined);
        runtime.ensureRuntimeForSession = vi.fn(async () => undefined);
        runtime.getSessionTranscript = vi.fn(async () => ({
            cwd: '/tmp/quantdesk-pi-runtime-test/workspace',
            messages: [
                {
                    content: '本周 AI 模型新闻有哪些',
                    id: 'user-1',
                    role: 'user',
                },
                {
                    content: 'JSONDecodeError: Expecting value',
                    id: 'tool-1',
                    isError: true,
                    role: 'toolResult',
                    toolCallId: 'tool-1',
                    toolName: 'bash',
                },
                {
                    content: '已改用 HN RSS 源完成新闻汇总。',
                    id: 'assistant-1',
                    role: 'assistant',
                },
            ],
            model: null,
            path: '/tmp/quantdesk-pi-runtime-test/sessions/session-1.jsonl',
            sessionId: 'session-1',
            thinkingLevel: 'off',
        }));
        runtime.runtime = {
            session: {
                prompt,
                sessionId: 'session-1',
                sessionManager: {
                    getEntries: () => [1],
                },
            },
        };

        const sendResult = await runtime.sendMessage({ message: 'hello pi' });
        runtime.toolInvocations.recordToolStart({
            args: {
                command: [
                    'curl -s "https://hn.algolia.com/api/v1/search?rows=15"',
                    'python3 -c "import json, sys; json.load(sys.stdin)"',
                ].join(' | '),
            },
            toolCallId: 'tool-1',
            toolName: 'bash',
        }, { runId: sendResult.runId, sessionId: 'session-1' });
        runtime.toolInvocations.recordToolEnd({
            isError: true,
            result: {
                content: [{ type: 'text', text: 'JSONDecodeError: Expecting value' }],
            },
            toolCallId: 'tool-1',
        }, { runId: sendResult.runId, sessionId: 'session-1' });
        runtime.toolInvocations.recordToolStart({
            args: {
                command: 'curl -s "https://hnrss.org/frontpage"',
            },
            toolCallId: 'tool-2',
            toolName: 'bash',
        }, { runId: sendResult.runId, sessionId: 'session-1' });
        runtime.toolInvocations.recordToolEnd({
            isError: false,
            result: {
                content: [{ type: 'text', text: 'RSS ok' }],
            },
            toolCallId: 'tool-2',
        }, { runId: sendResult.runId, sessionId: 'session-1' });
        resolvePrompt();

        await vi.waitFor(() => {
            expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({
                type: 'run_completed',
            }));
        });
        expect(emitEvent).not.toHaveBeenCalledWith(expect.objectContaining({
            type: 'run_failed',
        }));
        expect(runtime.lastError).toBeNull();
    });

    test('passes staged images and text documents to the Pi prompt while keeping run_started visible', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quantdesk-pi-attachments-'));
        const imagePath = path.join(tempDir, 'chart.png');
        const textPath = path.join(tempDir, 'notes.md');
        fs.writeFileSync(imagePath, 'image-bytes');
        fs.writeFileSync(textPath, '# Notes\nWatch duration risk.');

        try {
            const emitEvent = vi.fn();
            const prompt = vi.fn(async () => undefined);
            const runtime = createRuntimeHarness({
                directories: {
                    agentDir: path.join(tempDir, 'config'),
                    sessionDir: path.join(tempDir, 'sessions'),
                    toolInvocationDir: path.join(tempDir, 'tool-invocations'),
                    workspaceDir: path.join(tempDir, 'workspace'),
                },
                emitEvent,
                requestHost: vi.fn(),
            });

            runtime.emitDiagnosticsUpdated = vi.fn(async () => undefined);
            runtime.ensureRuntimeForSession = vi.fn(async () => undefined);
            runtime.getSessionTranscript = vi.fn(async () => ({
                cwd: path.join(tempDir, 'workspace'),
                messages: [],
                model: null,
                path: path.join(tempDir, 'sessions', 'session-1.jsonl'),
                sessionId: 'session-1',
                thinkingLevel: 'off',
            }));
            runtime.runtime = {
                session: {
                    prompt,
                    sessionId: 'session-1',
                    sessionManager: {
                        getEntries: () => [1],
                    },
                },
            };

            await runtime.sendMessage({
                attachments: [
                    {
                        id: '11111111-1111-4111-8111-111111111111',
                        kind: 'image',
                        mimeType: 'image/png',
                        name: 'chart.png',
                        path: imagePath,
                        size: fs.statSync(imagePath).size,
                    },
                    {
                        id: '22222222-2222-4222-8222-222222222222',
                        kind: 'text_document',
                        mimeType: 'text/markdown',
                        name: 'notes.md',
                        path: textPath,
                        size: fs.statSync(textPath).size,
                    },
                ],
                message: '分析这些附件',
            });

            expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({
                message: '分析这些附件',
                type: 'run_started',
            }));
            expect(prompt).toHaveBeenCalledWith(
                expect.stringContaining('Watch duration risk.'),
                { images: [{ data: Buffer.from('image-bytes').toString('base64'), mimeType: 'image/png', type: 'image' }] },
            );
        } finally {
            fs.rmSync(tempDir, { force: true, recursive: true });
        }
    });

    test('honors startNewSession when dispatching a run', async () => {
        const prompt = vi.fn(async () => undefined);
        const runtime = createRuntimeHarness({
            directories: {
                agentDir: '/tmp/quantdesk-pi-runtime-test/config',
                sessionDir: '/tmp/quantdesk-pi-runtime-test/sessions',
                toolInvocationDir: '/tmp/quantdesk-pi-runtime-test/tool-invocations',
                workspaceDir: '/tmp/quantdesk-pi-runtime-test/workspace',
            },
            emitEvent: () => undefined,
            requestHost: vi.fn(),
        });

        runtime.emitDiagnosticsUpdated = vi.fn(async () => undefined);
        runtime.ensureRuntimeForSession = vi.fn(async () => undefined);
        runtime.getSessionTranscript = vi.fn(async () => ({
            cwd: '/tmp/quantdesk-pi-runtime-test/workspace',
            messages: [],
            model: null,
            path: '/tmp/quantdesk-pi-runtime-test/sessions/session-1.jsonl',
            sessionId: 'session-1',
            thinkingLevel: 'off',
        }));
        runtime.runtime = {
            session: {
                prompt,
                sessionId: 'session-1',
                sessionManager: {
                    getEntries: () => [1],
                },
            },
        };

        await runtime.sendMessage({ message: 'isolated researcher', startNewSession: true });

        expect(runtime.ensureRuntimeForSession).toHaveBeenCalledWith(undefined, true);
    });

    test('blocks disallowed finance tools before requesting the host', async () => {
        const requestHost = vi.fn(async () => ({
            payload: {
                audit: {
                    generatedAt: '2026-04-28T00:00:00.000Z',
                    toolName: 'search_assets',
                },
                citations: [],
                ok: true,
                payload: {},
                richBlocks: [],
                summary: 'ok',
            },
        }));
        const runtime = createPrivateRuntimeHarness({
            directories: {
                agentDir: '/tmp/quantdesk-pi-runtime-test/config',
                sessionDir: '/tmp/quantdesk-pi-runtime-test/sessions',
                toolInvocationDir: '/tmp/quantdesk-pi-runtime-test/tool-invocations',
                workspaceDir: '/tmp/quantdesk-pi-runtime-test/workspace',
            },
            emitEvent: () => undefined,
            requestHost,
        });

        runtime.ai = {
            StringEnum: vi.fn((values, options) => ({ options, type: 'enum', values })),
            Type: fakePiTypeNamespace,
        };
        runtime.sdk = {
            defineTool: vi.fn((definition) => definition),
        };
        runtime.currentRun = {
            allowedToolNames: new Set(['search_assets']),
            cancelRequested: false,
            messageId: 'message-1',
            runId: 'run-1',
            sessionId: 'session-1',
        };
        runtime.runtime = {
            session: {
                sessionId: 'session-1',
                sessionManager: {
                    getEntries: () => [1],
                },
            },
        };

        const tools = runtime.createCustomTools();
        const searchAssetsTool = tools.find((tool) => tool.name === 'search_assets');
        const runAllocationTool = tools.find((tool) => tool.name === 'run_allocation');

        if (!searchAssetsTool || !runAllocationTool) {
            throw new Error('Expected finance test tools to be registered.');
        }

        await expect(runAllocationTool.execute('tool-1', {})).rejects.toThrow('Pi tool is not allowed for this run: run_allocation');
        expect(requestHost).not.toHaveBeenCalled();

        await expect(searchAssetsTool.execute('tool-2', { query: 'ETF' })).resolves.toEqual(expect.objectContaining({
            details: expect.objectContaining({ ok: true }),
        }));
        expect(requestHost).toHaveBeenCalledWith(expect.objectContaining({
            runId: 'run-1',
            toolCallId: 'tool-2',
            toolName: 'search_assets',
        }));
    });
});
