// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { AppRoutes, WorkbenchShell } from './App';
import { useShellStore } from './stores/shell-store';

const renderShell = (path = '/') =>
  render(
    <MemoryRouter
      future={{
        v7_relativeSplatPath: true,
        v7_startTransition: true,
      }}
      initialEntries={[path]}
    >
      <WorkbenchShell>
        <AppRoutes />
      </WorkbenchShell>
    </MemoryRouter>,
  );

describe('工作台外壳', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.colorScheme = '';

    useShellStore.setState({
      commandDeckOpen: false,
      isPrimaryRailCollapsed: false,
      isSidebarCollapsed: false,
    });

    window.api = {
      log: {
        openDirectory: vi.fn().mockResolvedValue(undefined),
        write: vi.fn(),
        writeBatch: vi.fn(),
      },
      system: {
        checkNativeBindings: vi.fn().mockResolvedValue({
          driver: 'better-sqlite3',
          memoryDbReady: true,
          sqliteVersion: '3.47.0',
        }),
        getRuntimeStatus: vi.fn().mockResolvedValue({
          lastError: null,
          logDir: null,
          sidecarPid: null,
          sidecarPort: null,
          sidecarReady: false,
        }),
        ping: vi.fn().mockResolvedValue({
          appVersion: '0.1.0-test',
          message: 'pong',
          timestamp: '2026-04-10T00:00:00.000Z',
        }),
        runDummyPython: vi.fn().mockResolvedValue({
          command: 'python3',
          exitCode: 0,
          scriptPath: '/workspace/sidecar/scripts/dummy.py',
          stderr: '',
          stdout: 'dummy-ok',
        }),
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
      data: {
        addAsset: vi.fn(),
        deleteAsset: vi.fn(),
        deletePosition: vi.fn(),
        clearCache: vi.fn().mockResolvedValue({
          cacheSummary: {
            assetCount: 0,
            fxRateRowCount: 0,
            latestPriceFetchAt: null,
            priceRowCount: 0,
          },
          syncStatus: {
            activeTask: null,
            completedTasks: 0,
            failedTasks: 0,
            lastWarning: null,
            queuedTasks: 0,
            recentEvents: [],
            running: false,
          },
        }),
        getAssets: vi.fn().mockResolvedValue([]),
        getCacheSummary: vi.fn().mockResolvedValue({
          assetCount: 0,
          fxRateRowCount: 0,
          latestPriceFetchAt: null,
          priceRowCount: 0,
        }),
        getSyncStatus: vi.fn().mockResolvedValue({
          activeTask: null,
          completedTasks: 0,
          failedTasks: 0,
          lastWarning: null,
          queuedTasks: 0,
          recentEvents: [],
          running: false,
        }),
        subscribeSyncStatus: vi.fn().mockReturnValue(() => undefined),
        getPositions: vi.fn().mockResolvedValue([]),
        getPriceRange: vi.fn().mockResolvedValue([]),
        getPrices: vi.fn().mockResolvedValue([]),
        importAssetsCsv: vi.fn().mockResolvedValue({
          errorCount: 0,
          errors: [],
          skippedCount: 0,
          successCount: 0,
        }),
        importPositionsCsv: vi.fn().mockResolvedValue({
          errorCount: 0,
          errors: [],
          skippedCount: 0,
          successCount: 0,
        }),
        importPricesCsv: vi.fn().mockResolvedValue({
          errorCount: 0,
          errors: [],
          skippedCount: 0,
          successCount: 0,
        }),
        lookupAssets: vi.fn().mockResolvedValue([]),
        searchAssets: vi.fn().mockResolvedValue([]),
        syncFxRates: vi.fn().mockResolvedValue({ insertedRows: 0, pairs: [], warnings: [] }),
        syncPrices: vi.fn().mockResolvedValue({
          fxPairs: [],
          insertedRows: 0,
          skippedAssetIds: [],
          syncStatus: {
            activeTask: null,
            completedTasks: 0,
            failedTasks: 0,
            lastWarning: null,
            queuedTasks: 0,
            recentEvents: [],
            running: false,
          },
          synchronizedAssetIds: [],
          warnings: [],
        }),
        updateAsset: vi.fn(),
        updatePosition: vi.fn(),
      },
      portfolio: {
        deletePlan: vi.fn().mockResolvedValue(true),
        getPlans: vi.fn().mockResolvedValue([]),
        runAllocation: vi.fn(),
        savePlan: vi.fn(),
      },
      research: {
        cancelResearch: vi.fn().mockResolvedValue({ cancelled: false }),
        getResearchArtifacts: vi.fn().mockResolvedValue([]),
        getResearchRequest: vi.fn().mockResolvedValue(null),
        getRiskProfile: vi.fn().mockResolvedValue(null),
        listResearchRequests: vi.fn().mockResolvedValue({ items: [], nextOffset: null, total: 0 }),
        onResearchStream: vi.fn().mockReturnValue(() => undefined),
        saveRiskProfile: vi.fn().mockImplementation(async (profile) => profile),
        startResearch: vi.fn(),
      },
      settings: {
        get: vi.fn().mockResolvedValue(null),
        getAll: vi.fn().mockResolvedValue({}),
        delete: vi.fn().mockResolvedValue(true),
        set: vi.fn().mockResolvedValue('USD'),
      },
      secrets: {
        delete: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue(undefined),
      },
    } as unknown as Window['api'];
  });

  test('在桌面壳中渲染全部五个主入口并保留可折叠导航', async () => {
    renderShell('/');

    await screen.findByRole('heading', { name: /^仪表盘$/i });
    await screen.findByRole('heading', { name: /宏观驾驶舱/i });

    for (const destination of [
      '仪表盘',
      '资产池',
      '配置方案',
      'Pi Agent',
      '设置',
    ]) {
      expect(screen.getAllByRole('link', { name: new RegExp(destination, 'i') }).length).toBeGreaterThan(0);
    }

    expect(screen.queryByRole('link', { name: /投研台/i })).not.toBeInTheDocument();

    expect(screen.getByTestId('workspace-brand-label')).toHaveAttribute('aria-hidden', 'false');
    expect(
      screen.getByRole('heading', { name: /宏观驾驶舱/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^仪表盘$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /查看 .* 模块说明/i })).not.toBeInTheDocument();
  });

  test('壳层保留当前模块和页面标题，但不再显示模块说明入口', async () => {
    renderShell('/allocation');

    await screen.findByRole('heading', { name: /^配置方案$/i });

    expect(screen.getByRole('heading', { name: /^配置工坊$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^配置方案$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /查看 .* 模块说明/i })).not.toBeInTheDocument();
  });

  test('直接进入设置页时渲染设置占位内容', async () => {
    renderShell('/settings');

    await screen.findByRole('heading', { name: /^设置$/i });

    expect(screen.getByRole('heading', { name: /^配置中心$/i })).toBeInTheDocument();
    expect(screen.getByTestId('settings-pi-runtime-section')).toBeInTheDocument();
    expect(screen.getByTestId('settings-preferences-section')).toBeInTheDocument();
    expect(screen.queryByText(/集中管理默认基准货币、数据源开关、缓存、sidecar 状态和 LLM provider/i)).not.toBeInTheDocument();
  });

  test('点击品牌图标可将左侧导航切换为折叠模式', async () => {
    const user = userEvent.setup();

    renderShell('/');

    const collapseButton = await screen.findByRole('button', { name: /^收起左侧导航$/i });
    expect(screen.getByTestId('workspace-brand-label')).toHaveAttribute('aria-hidden', 'false');

    await user.click(collapseButton);

    expect(screen.getByTestId('workspace-brand-label')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('link', { name: /^仪表盘$/i })).not.toHaveClass('mx-auto');
    expect(screen.getByRole('button', { name: /^展开左侧导航$/i })).toBeInTheDocument();
  });

  test('左下角太阳月亮按钮可切换并持久化暗色模式', async () => {
    const user = userEvent.setup();

    renderShell('/');

    const themeToggle = await screen.findByRole('button', { name: /^切换到暗色模式$/i });

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('light');
    });

    await user.click(themeToggle);

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem('quantdesk-theme-mode')).toBe('dark');
    expect(screen.getByRole('button', { name: /^切换到浅色模式$/i })).toBeInTheDocument();
  });

  test('点击仪表盘标签跳转到仪表盘', async () => {
    const user = userEvent.setup();

    renderShell('/settings');

    await screen.findByRole('heading', { name: /^设置$/i });

    await user.click(screen.getByRole('link', { name: /^仪表盘$/i }));

    expect(
      await screen.findByRole('heading', { name: /宏观驾驶舱/i }),
    ).toBeInTheDocument();
  });
});
