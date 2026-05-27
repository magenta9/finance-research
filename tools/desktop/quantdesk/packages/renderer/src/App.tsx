import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { HashRouter, Route, Routes, useLocation } from 'react-router-dom';

import {
  AllocationPage,
  AssetsPage,
  DashboardPage,
  PiAgentPage,
  RailLink,
  SettingsPage,
} from './routes/route-definitions';
import { routeDefinitions } from './routes/route-metadata';
import { useShellStore } from './stores/shell-store';

type ThemeMode = 'light' | 'dark';

const THEME_STORAGE_KEY = 'quantdesk-theme-mode';

const resolveInitialThemeMode = (): ThemeMode => {
  if (typeof window === 'undefined') {
    return 'light';
  }

  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);

    if (storedTheme === 'light' || storedTheme === 'dark') {
      return storedTheme;
    }
  } catch (error) {
    console.warn('[theme] Failed to read persisted theme mode.', error);
    return 'light';
  }

  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

const ThemeToggle = ({
  className = '',
  mode,
  onToggle,
}: {
  className?: string;
  mode: ThemeMode;
  onToggle: () => void;
}) => {
  const isDark = mode === 'dark';

  return (
    <button
      aria-label={isDark ? '切换到浅色模式' : '切换到暗色模式'}
      aria-pressed={isDark}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-full border border-transparent bg-[var(--color-surface-strong)] text-[var(--color-foreground)] shadow-[0_12px_30px_rgba(61,43,31,0.08)] transition-[background-color,border-color,color,transform] duration-200 hover:border-[var(--color-highlight-soft)] hover:text-[var(--color-highlight)] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(188,140,88,0.34)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent ${className}`}
      onClick={onToggle}
      style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
      title={isDark ? '切换到浅色模式' : '切换到暗色模式'}
      type="button"
    >
      <span aria-hidden="true" className="relative flex h-5 w-5 items-center justify-center overflow-hidden text-[17px] leading-none">
        <span className={`absolute transition duration-200 ${isDark ? 'rotate-90 opacity-0' : 'rotate-0 opacity-100'}`}>☀</span>
        <span className={`absolute transition duration-200 ${isDark ? 'rotate-0 opacity-100' : '-rotate-90 opacity-0'}`}>☾</span>
      </span>
    </button>
  );
};

const useActiveRoute = () => {
  const { pathname } = useLocation();

  return useMemo(
    () =>
      routeDefinitions.find((route) =>
        route.path === '/'
          ? pathname === '/'
          : pathname.startsWith(route.path),
      ) ?? routeDefinitions[0],
    [pathname],
  );
};

export const AppRoutes = () => {
  return (
    <Routes>
      <Route
        element={<DashboardPage />}
        path="/"
      />
      <Route
        element={<AssetsPage />}
        path="/assets"
      />
      <Route
        element={<AllocationPage />}
        path="/allocation"
      />
      <Route
        element={<PiAgentPage />}
        path="/pi-agent"
      />
      <Route
        element={<SettingsPage />}
        path="/settings"
      />
    </Routes>
  );
};

export const WorkbenchShell = ({
  children,
}: {
  children: ReactNode;
}) => {
  const activeRoute = useActiveRoute();
  const isImmersiveWorkspace = activeRoute.path === '/pi-agent';
  const isPrimaryRailCollapsed = useShellStore((state) => state.isPrimaryRailCollapsed);
  const setPrimaryRailCollapsed = useShellStore((state) => state.setPrimaryRailCollapsed);
  const [themeMode, setThemeMode] = useState<ThemeMode>(resolveInitialThemeMode);
  const [navRailWidth, setNavRailWidth] = useState(196);
  const resizeStateRef = useRef<{ pointerId: number | null; startX: number; startWidth: number }>({
    pointerId: null,
    startX: 0,
    startWidth: 196,
  });
  const shellLayoutClassName = isImmersiveWorkspace
    ? 'h-screen overflow-hidden'
    : 'min-h-screen';
  const shellInnerClassName = isImmersiveWorkspace
    ? 'h-full overflow-hidden'
    : 'min-h-screen';
  const usesMacElectronTitlebarInset = typeof navigator !== 'undefined'
    && navigator.userAgent.includes('Electron')
    && navigator.platform.toLowerCase().includes('mac');
  const shellPaddingClassName = usesMacElectronTitlebarInset ? 'px-3 pb-3 pt-10' : 'p-3';
  const mainClassName = [
    'flex min-w-0 flex-1 flex-col rounded-[34px] border border-[color:var(--color-border)] bg-[var(--color-surface-strong)] shadow-[0_30px_90px_rgba(61,43,31,0.08)] backdrop-blur',
    isImmersiveWorkspace ? 'min-h-0 overflow-hidden p-3 lg:p-4' : 'p-3 lg:p-4',
  ].join(' ');
  const contentClassName = isImmersiveWorkspace
    ? 'min-h-0 flex-1 overflow-hidden'
    : 'min-h-0 flex-1';
  const shellInnerLayoutClassName = isImmersiveWorkspace ? 'md:flex-row' : 'lg:flex-row';
  const navRailClassName = [
    'relative flex w-full flex-col overflow-hidden rounded-[28px] border border-[color:var(--color-border)] bg-[var(--color-surface)] p-3 shadow-[0_18px_60px_rgba(61,43,31,0.08)] backdrop-blur transition-[width,padding] duration-300 ease-out',
    isImmersiveWorkspace
      ? 'shrink-0 max-md:max-h-[96px] max-md:flex-row max-md:items-center max-md:gap-2 max-md:overflow-x-auto md:w-[88px] md:shrink-0 xl:w-[var(--nav-rail-width)]'
      : 'max-lg:max-h-[76px] max-lg:flex-row max-lg:items-center max-lg:gap-2 max-lg:overflow-x-auto max-lg:p-2 lg:w-[var(--nav-rail-width)] lg:shrink-0',
  ].join(' ');
  const brandButtonClassName = [
    'flex h-12 w-full items-center gap-2 rounded-[16px] border border-transparent bg-[rgba(156,98,55,0.06)] px-1 py-0 text-left transition-all duration-300 ease-out hover:bg-[rgba(156,98,55,0.11)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(188,140,88,0.28)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent',
    isPrimaryRailCollapsed ? 'justify-center' : '',
    isImmersiveWorkspace
      ? [
        'max-md:h-12 max-md:w-12 max-md:justify-center max-md:px-0 max-md:py-0 max-md:rounded-[16px]',
        isPrimaryRailCollapsed ? '' : 'md:h-12 md:w-12 md:justify-center md:px-0 md:py-0 md:rounded-[16px] xl:w-full xl:justify-start xl:px-1',
      ].join(' ')
      : 'max-lg:h-12 max-lg:w-12 max-lg:justify-center max-lg:px-0 max-lg:py-0 max-lg:rounded-[16px]',
  ].join(' ');
  const brandLabelClassName = [
    'min-w-0 overflow-hidden whitespace-nowrap transition-all duration-300 ease-out',
    isPrimaryRailCollapsed ? 'max-w-0 translate-x-1 opacity-0' : 'max-w-[144px] translate-x-0 opacity-100',
    isImmersiveWorkspace ? 'max-xl:max-w-0 max-xl:opacity-0' : 'max-lg:max-w-0 max-lg:opacity-0',
  ].join(' ');
  const navClassName = [
    'mt-5 flex flex-1 flex-col gap-2',
    isImmersiveWorkspace ? 'max-md:mt-0 max-md:min-w-0 max-md:flex-row max-md:overflow-x-auto' : 'max-lg:mt-0 max-lg:min-w-0 max-lg:flex-row max-lg:overflow-x-auto',
  ].join(' ');
  const navResizeClassName = isImmersiveWorkspace ? 'xl:flex' : 'lg:flex';
  const navRailStyle = {
    '--nav-rail-width': `${isPrimaryRailCollapsed ? 88 : navRailWidth}px`,
  } as CSSProperties;

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    document.documentElement.style.colorScheme = themeMode;

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    } catch (error) {
      console.warn('[theme] Failed to persist theme mode.', error);
    }
  }, [themeMode]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (resizeStateRef.current.pointerId === null) {
        return;
      }

      const nextWidth = Math.min(
        320,
        Math.max(168, resizeStateRef.current.startWidth + event.clientX - resizeStateRef.current.startX),
      );
      setNavRailWidth(nextWidth);
    };

    const finishResize = (event: PointerEvent) => {
      if (resizeStateRef.current.pointerId !== event.pointerId) {
        return;
      }

      resizeStateRef.current.pointerId = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', finishResize);
    window.addEventListener('pointercancel', finishResize);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', finishResize);
      window.removeEventListener('pointercancel', finishResize);
    };
  }, []);

  const handleNavResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    resizeStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: navRailWidth,
    };
  };

  const handleNavResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }

    event.preventDefault();
    const delta = event.key === 'ArrowLeft' ? -16 : 16;
    setNavRailWidth((currentWidth) => Math.min(320, Math.max(168, currentWidth + delta)));
  };

  return (
    <div className={`${isImmersiveWorkspace ? 'agent-workspace-theme ' : ''}${shellLayoutClassName} bg-[var(--color-background)] text-[var(--color-foreground)]`}>
      <ThemeToggle
        className="fixed bottom-4 left-10 z-50"
        mode={themeMode}
        onToggle={() => setThemeMode((currentMode) => (currentMode === 'dark' ? 'light' : 'dark'))}
      />
      {usesMacElectronTitlebarInset && (
        <div
          aria-hidden="true"
          className="fixed inset-x-0 top-0 z-40 h-9"
          style={{ WebkitAppRegion: 'drag' } as CSSProperties}
        />
      )}
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(217,188,154,0.24),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(156,98,55,0.08),transparent_32%)]" />
      <div className="pointer-events-none fixed inset-0 opacity-35 [background-image:linear-gradient(rgba(80,56,41,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(80,56,41,0.05)_1px,transparent_1px)] [background-size:56px_56px]" />

      <div className={`relative mx-auto flex w-full max-w-[1800px] flex-col gap-3 ${shellPaddingClassName} ${shellInnerLayoutClassName} ${shellInnerClassName}`}>
        <aside
          style={navRailStyle}
          className={navRailClassName}
        >
          <button
            aria-label={isPrimaryRailCollapsed ? '展开左侧导航' : '收起左侧导航'}
            aria-pressed={!isPrimaryRailCollapsed}
            className={brandButtonClassName}
            onClick={() => {
              setPrimaryRailCollapsed(!isPrimaryRailCollapsed);
            }}
            type="button"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-[rgba(156,98,55,0.14)] font-display text-xl text-[var(--color-foreground)]">
              QD
            </div>
            <div
              data-testid="workspace-brand-label"
              aria-hidden={isPrimaryRailCollapsed}
              className={brandLabelClassName}
            >
              <p className="font-display text-lg text-[var(--color-foreground)]">
                QuantDesk
              </p>
              <p className="mt-1 text-[10px] uppercase tracking-[0.34em] text-[var(--color-muted)]">
                工作台
              </p>
            </div>
          </button>

          <nav className={navClassName}>
            {routeDefinitions.map((route) => (
              <RailLink
                compact={isPrimaryRailCollapsed}
                compactBelowLarge={!isImmersiveWorkspace}
                compactOnMedium={isImmersiveWorkspace}
                compactOnSmall={isImmersiveWorkspace}
                key={route.path}
                route={route}
              />
            ))}
          </nav>

          {!isPrimaryRailCollapsed && (
            <div
              aria-controls="quantdesk-main-content"
              aria-label="调整标签列宽度"
              aria-orientation="vertical"
              aria-valuemax={320}
              aria-valuemin={168}
              aria-valuenow={navRailWidth}
              className={`absolute inset-y-4 right-0 hidden w-4 translate-x-1/2 cursor-col-resize touch-none select-none items-center justify-center ${navResizeClassName}`}
              onKeyDown={handleNavResizeKeyDown}
              onPointerDown={handleNavResizeStart}
              role="separator"
              tabIndex={0}
            >
              <span className="h-20 w-[3px] rounded-full bg-[rgba(156,98,55,0.24)] transition-colors duration-200 hover:bg-[rgba(156,98,55,0.45)] focus-visible:bg-[rgba(156,98,55,0.45)]" />
            </div>
          )}
        </aside>

        <main className={mainClassName} id="quantdesk-main-content">
          {!isImmersiveWorkspace && (
            <header className="mb-3 rounded-[16px] border border-[color:var(--color-border)] bg-[rgba(255,252,248,0.92)] p-2 shadow-[0_10px_26px_rgba(61,43,31,0.05)]">
              <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
                <div className="min-w-0 px-2 py-1">
                  <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                    当前模块
                  </p>
                  <h2 className="mt-1.5 truncate font-display text-[1.25rem] leading-6 text-[var(--color-foreground)]">
                    {activeRoute.sidebarTitle}
                  </h2>
                </div>
                <div className="flex h-8 items-center rounded-[11px] border border-[color:var(--color-highlight-soft)] bg-[rgba(156,98,55,0.08)] px-3">
                  <h1 className="truncate text-sm font-semibold text-[var(--color-foreground)]">
                    {activeRoute.label}
                  </h1>
                </div>
              </div>
            </header>
          )}

          <div className={contentClassName}>{children}</div>
        </main>
      </div>
    </div>
  );
};

const App = () => (
  <HashRouter
    future={{
      v7_relativeSplatPath: true,
      v7_startTransition: true,
    }}
  >
    <WorkbenchShell>
      <AppRoutes />
    </WorkbenchShell>
  </HashRouter>
);

export default App;
