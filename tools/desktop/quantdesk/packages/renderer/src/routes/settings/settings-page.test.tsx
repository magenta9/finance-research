// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { SyncStatus } from '@quantdesk/shared/types/market';
import type { QuantdeskApi } from '@quantdesk/shared/types/api';

import { setApiClientOverride } from '../../lib/api-client';
import { SettingsPage } from './settings-page';
import { formatPiModelDisplay } from './use-settings-page-controller';

describe('SettingsPage', () => {
    let mockApi: QuantdeskApi;
    let syncListener: ((status: SyncStatus) => void) | null;

    beforeEach(() => {
        syncListener = null;
        vi.spyOn(window, 'confirm').mockReturnValue(true);

        mockApi = {
            log: {
                openDirectory: vi.fn().mockResolvedValue(undefined),
                write: vi.fn(),
                writeBatch: vi.fn(),
            },
            data: {
                addAsset: vi.fn(),
                clearCache: vi.fn().mockResolvedValue({
                    cacheSummary: {
                        assetCount: 3,
                        fxRateRowCount: 0,
                        latestPriceFetchAt: null,
                        priceRowCount: 0,
                    },
                    syncStatus: {
                        activeTask: null,
                        completedTasks: 4,
                        failedTasks: 0,
                        lastWarning: null,
                        queuedTasks: 0,
                        recentEvents: [],
                        running: false,
                    },
                }),
                deleteAsset: vi.fn(),
                deletePosition: vi.fn(),
                getAssets: vi.fn().mockResolvedValue([]),
                getCacheSummary: vi.fn().mockResolvedValue({
                    assetCount: 3,
                    fxRateRowCount: 2,
                    latestPriceFetchAt: '2026-04-13T00:00:00.000Z',
                    priceRowCount: 42,
                }),
                getPositions: vi.fn().mockResolvedValue([]),
                getPriceRange: vi.fn().mockResolvedValue([]),
                getPrices: vi.fn().mockResolvedValue([]),
                getSyncStatus: vi.fn().mockResolvedValue({
                    activeTask: {
                        endDate: '2026-04-13',
                        key: 'price:asset-1:2026-04-01:2026-04-13',
                        kind: 'price',
                        priority: 'background',
                        startDate: '2026-04-01',
                        status: 'running',
                        target: 'asset-1',
                        taskId: 'task-1',
                    },
                    completedTasks: 3,
                    failedTasks: 0,
                    lastWarning: '旧缓存仍在使用',
                    queuedTasks: 2,
                    recentEvents: [],
                    running: true,
                }),
                importAssetsCsv: vi.fn(),
                importPositionsCsv: vi.fn(),
                importPricesCsv: vi.fn(),
                lookupAssets: vi.fn(),
                searchAssets: vi.fn(),
                subscribeSyncStatus: vi.fn().mockImplementation((listener: (status: SyncStatus) => void) => {
                    syncListener = listener;
                    return () => {
                        syncListener = null;
                    };
                }),
                syncFxRates: vi.fn().mockResolvedValue({ insertedRows: 0, pairs: [], warnings: [] }),
                syncPrices: vi.fn(),
                updateAsset: vi.fn(),
                updatePosition: vi.fn(),
            },
            portfolio: {
                deletePlan: vi.fn(),
                getPlans: vi.fn().mockResolvedValue([]),
                runAllocation: vi.fn(),
                savePlan: vi.fn(),
            },
            piAgent: {
                cancelRun: vi.fn(),
                deleteSession: vi.fn(),
                discardAttachments: vi.fn(),
                getSession: vi.fn().mockResolvedValue(null),
                getSessionTranscript: vi.fn(),
                listSessions: vi.fn().mockResolvedValue([]),
                listSkills: vi.fn().mockResolvedValue([]),
                onStream: vi.fn().mockReturnValue(() => undefined),
                sendMessage: vi.fn(),
                stageAttachments: vi.fn(),
            },
            piRuntime: {
                acknowledgeHighPrivilegeRisk: vi.fn().mockResolvedValue({
                    acknowledged: true,
                    acknowledgedAt: '2026-04-15T00:00:00.000Z',
                    message: '已确认高权限风险',
                }),
                getRiskGateState: vi.fn().mockResolvedValue({
                    acknowledged: false,
                    acknowledgedAt: null,
                    message: '发送消息前需要确认高权限风险。',
                }),
                getStatus: vi.fn().mockResolvedValue({
                    degraded: false,
                    degradedReason: null,
                    diagnostics: [],
                    directories: {
                        agentDir: '/tmp/pi/agent',
                        sessionDir: '/tmp/pi/session',
                        toolInvocationDir: '/tmp/pi/tool',
                        workspaceDir: '/tmp/pi/workspace',
                    },
                    financeTools: {
                        available: true,
                        lastError: null,
                        names: ['analyze_asset', 'search_quantdesk_docs'],
                    },
                    lastError: null,
                    lastStartedAt: '2026-04-15T00:00:00.000Z',
                    model: {
                        model: 'qwen3:latest',
                        provider: 'openai-compatible',
                    },
                    pid: 789,
                    sessionCount: 0,
                    state: 'ready',
                }),
                openDirectory: vi.fn().mockResolvedValue(undefined),
            },
            secrets: {
                delete: vi.fn(),
                get: vi.fn(),
                set: vi.fn(),
            },
            settings: {
                delete: vi.fn(),
                get: vi.fn().mockResolvedValue(null),
                getAll: vi.fn().mockResolvedValue({
                    'dataSource.akshare.enabled': 'true',
                    'dataSource.frankfurter.enabled': 'true',
                    'dataSource.tushare.enabled': 'true',
                    'dataSource.yfinance.enabled': 'true',
                    baseCurrency: 'CNY',
                    defaultMarket: 'US',
                    defaultMaxSingleWeight: '0.35',
                    language: 'zh-CN',
                }),
                set: vi.fn().mockResolvedValue('true'),
            },
            system: {
                checkNativeBindings: vi.fn(),
                getRuntimeStatus: vi.fn().mockResolvedValue({
                    lastError: null,
                    logDir: '/tmp/logs',
                    metadataBackfill: {
                        completedAt: '2026-04-15T00:00:03.000Z',
                        failedAssets: 1,
                        lastError: null,
                        scannedAssets: 5,
                        startedAt: '2026-04-15T00:00:00.000Z',
                        state: 'completed',
                        updatedAssets: 3,
                    },
                    sidecarPid: 123,
                    sidecarPort: 9000,
                    sidecarReady: true,
                }),
                ping: vi.fn().mockResolvedValue({
                    appVersion: '0.1.0',
                    message: 'pong',
                    timestamp: '2026-04-15T00:00:00.000Z',
                }),
                runDummyPython: vi.fn(),
            },
            runtime: {
                getCapabilities: vi.fn().mockResolvedValue({
                    hasKeytarSecrets: true,
                    hasNativeFileDialog: true,
                    hasNativeNotifications: true,
                    hasSidecarAutoStart: true,
                }),
                getConfig: vi.fn().mockResolvedValue({
                    lastConnectedAt: null,
                    lastConnectionError: null,
                    lastInitializationError: null,
                    sidecarUrl: 'ws://127.0.0.1:8765',
                }),
                getMode: vi.fn().mockResolvedValue('electron'),
                updateConfig: vi.fn().mockImplementation(async (updates) => ({
                    lastConnectedAt: null,
                    lastConnectionError: null,
                    lastInitializationError: null,
                    sidecarUrl: updates.sidecarUrl ?? 'ws://127.0.0.1:8765',
                })),
                validateProviderConnection: vi.fn().mockResolvedValue({ availableModels: ['qwen3:latest'], ok: true }),
                validateSidecarConnection: vi.fn().mockResolvedValue({ ok: true }),
            },
        } as unknown as QuantdeskApi;

        setApiClientOverride(mockApi);
    });

    afterEach(() => {
        setApiClientOverride(null);
    });

    test('显示 Pi runtime 分区，并在确认后清除本地行情缓存', async () => {
        const user = userEvent.setup();

        render(<SettingsPage />);

        await screen.findByTestId('settings-page');

        expect(screen.getByTestId('settings-pi-runtime-section')).toBeInTheDocument();
        expect(screen.getByTestId('settings-preferences-section')).toBeInTheDocument();
        expect(screen.getByTestId('settings-cache-section')).toBeInTheDocument();
        expect(screen.getByTestId('settings-runtime-section')).toBeInTheDocument();
        expect(screen.getByText('qwen3:latest [openai-compatible]')).toBeInTheDocument();
        expect(screen.getByTestId('settings-pi-diagnostics-list')).toHaveTextContent('analyze_asset, search_quantdesk_docs');
        expect(screen.getByTestId('settings-metadata-backfill-summary')).toHaveTextContent('已完成 · 更新 3 / 5');
        expect(screen.getByText('最近 warning：旧缓存仍在使用')).toBeInTheDocument();

        await act(async () => {
            syncListener?.({
                activeTask: null,
                completedTasks: 5,
                failedTasks: 0,
                lastWarning: '后台同步完成',
                queuedTasks: 0,
                recentEvents: [],
                running: false,
            });
        });

        await waitFor(() => {
            expect(screen.getByText('最近 warning：后台同步完成')).toBeInTheDocument();
        });

        await user.click(screen.getByTestId('settings-clear-cache-button'));

        expect(window.confirm).toHaveBeenCalledTimes(1);
        await waitFor(() => {
            expect(mockApi.data.clearCache).toHaveBeenCalledTimes(1);
        });
        expect(screen.getByText('本地行情缓存已清除。')).toBeInTheDocument();
    });

    test('确认 Pi 高权限风险会调用 runtime API', async () => {
        const user = userEvent.setup();

        render(<SettingsPage />);

        await screen.findByTestId('settings-page');
        await user.click(screen.getByTestId('settings-pi-ack-risk'));

        await waitFor(() => {
            expect(mockApi.piRuntime.acknowledgeHighPrivilegeRisk).toHaveBeenCalledTimes(1);
        });

        expect(screen.getByText('已确认 Pi Agent 高权限风险。')).toBeInTheDocument();
    });

    test('打开偏好编辑弹窗后保存会关闭弹窗', async () => {
        const user = userEvent.setup();

        render(<SettingsPage />);

        await screen.findByTestId('settings-page');
        await user.click(screen.getByTestId('settings-open-preferences-modal'));

        expect(await screen.findByTestId('settings-preferences-modal')).toBeInTheDocument();

        await user.selectOptions(screen.getByTestId('settings-base-currency-select'), 'USD');
        await user.click(screen.getByTestId('settings-save-preferences'));

        await waitFor(() => {
            expect(mockApi.settings.set).toHaveBeenCalledWith('baseCurrency', 'USD');
            expect(screen.queryByTestId('settings-preferences-modal')).not.toBeInTheDocument();
        });
    });

    test('browser-live 模式下可以验证 sidecar 连接并刷新最近连接状态', async () => {
        const user = userEvent.setup();

        vi.mocked(mockApi.runtime.getMode).mockResolvedValue('browser-live');
        vi.mocked(mockApi.runtime.getConfig)
            .mockResolvedValueOnce({
                lastConnectedAt: null,
                lastConnectionError: 'connect ECONNREFUSED 127.0.0.1:8765',
                lastInitializationError: null,
                sidecarUrl: 'ws://127.0.0.1:8765',
            })
            .mockResolvedValueOnce({
                lastConnectedAt: '2026-04-19T12:45:00.000Z',
                lastConnectionError: null,
                lastInitializationError: null,
                sidecarUrl: 'ws://127.0.0.1:9000',
            });

        render(<SettingsPage />);

        await screen.findByTestId('settings-page');
        expect(screen.getByTestId('settings-browser-sidecar-url')).toBeInTheDocument();
        expect(screen.getByText('最近成功连接：无')).toBeInTheDocument();
        expect(screen.getByTestId('settings-browser-live-error')).toHaveTextContent('connect ECONNREFUSED 127.0.0.1:8765');

        await user.clear(screen.getByTestId('settings-browser-sidecar-url'));
        await user.type(screen.getByTestId('settings-browser-sidecar-url'), 'ws://127.0.0.1:9000');
        await user.click(screen.getByTestId('settings-browser-validate-sidecar'));

        await waitFor(() => {
            expect(mockApi.runtime.updateConfig).toHaveBeenCalledWith({ sidecarUrl: 'ws://127.0.0.1:9000' });
            expect(mockApi.runtime.validateSidecarConnection).toHaveBeenCalledWith({ sidecarUrl: 'ws://127.0.0.1:9000' });
        });

        expect(await screen.findByText('Sidecar 连接验证成功。')).toBeInTheDocument();
        expect(screen.getByText('最近成功连接：2026-04-19T12:45:00.000Z')).toBeInTheDocument();
        expect(screen.getByTestId('settings-browser-live-error')).toHaveTextContent('无');
    });
});

describe('formatPiModelDisplay', () => {
    test('uses provider-scoped available model variant when runtime reports base model', () => {
        expect(formatPiModelDisplay({
            available: true,
            availableModels: ['minimax-cn/MiniMax-M2.7-highspeed'],
            model: 'MiniMax-M2.7',
            provider: 'minimax-cn',
            source: 'runtime',
        })).toEqual({
            detail: 'Pi runtime active model',
            value: 'MiniMax-M2.7-highspeed [minimax-cn]',
        });
    });
});
