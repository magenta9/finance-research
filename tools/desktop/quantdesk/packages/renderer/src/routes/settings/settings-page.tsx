import type { PiRuntimeDirectoryTarget } from '@quantdesk/shared/types/pi-runtime';

import { Badge } from '../../components/badge';
import { Button } from '../../components/button';
import { InlineNotice } from '../../components/inline-notice';
import { PreferencesEditModal } from './preferences-edit-modal';
import {
    CacheSummarySection,
    RuntimeSummarySection,
    SettingsMetricCard,
    PreferencesSummarySection,
} from './settings-sections';
import { useSettingsPageController } from './use-settings-page-controller';

export const SettingsPage = () => {
    const {
        browserLiveConfig,
        cacheSummary,
        dataSourceSummary,
        errorMessage,
        handleAcknowledgePiRisk,
        handleClearCache,
        handleClearMessages,
        handleClosePreferencesModal,
        handleOpenLogDirectory,
        handleOpenPreferencesModal,
        handleRefreshPiRuntime,
        handleReloadSettings,
        handleSavePreferences,
        handleValidateSidecarConnection,
        isLoading,
        isPreferencesModalOpen,
        isSavingPreferences,
        isValidatingSidecar,
        metrics,
        noticeMessage,
        openPiDirectory,
        piRiskGateState,
        piStatus,
        preferencesDraft,
        runtimeMode,
        runtimeStatus,
        setPreferencesDraft,
        setSidecarUrlDraft,
        sidecarUrlDraft,
        syncStatus,
    } = useSettingsPageController();

    return (
        <section className="space-y-4" data-testid="settings-page">
            {(noticeMessage || errorMessage) && (
                <InlineNotice
                    message={errorMessage ?? noticeMessage}
                    onDismiss={handleClearMessages}
                    tone={errorMessage ? 'danger' : 'default'}
                />
            )}

            <section className="grid gap-3 xl:grid-cols-4">
                {metrics.map((metric) => (
                    <SettingsMetricCard detail={metric.detail} key={metric.label} label={metric.label} value={metric.value} />
                ))}
            </section>

            <section className="rounded-[20px] border border-[color:var(--color-border)] bg-[rgba(255,252,248,0.78)] p-4 shadow-[0_12px_32px_rgba(61,43,31,0.05)]" data-testid="settings-pi-runtime-section">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div>
                        <p className="text-xs uppercase tracking-[0.3em] text-[var(--color-muted)]">Pi Runtime</p>
                        <h2 className="mt-2 font-display text-2xl text-[var(--color-foreground)]">独立 Pi wrapper、risk gate 与目录入口</h2>
                    </div>
                    <div className="flex flex-wrap gap-3">
                        <Button data-testid="settings-pi-refresh" onClick={handleRefreshPiRuntime} tone="ghost">刷新 Pi 状态</Button>
                        {!piRiskGateState?.acknowledged && (
                            <Button data-testid="settings-pi-ack-risk" onClick={handleAcknowledgePiRisk} tone="danger">确认高权限风险</Button>
                        )}
                    </div>
                </div>

                {!piStatus ? (
                    <div className="mt-4 rounded-[16px] border border-dashed border-[color:var(--color-border)] bg-[rgba(244,239,230,0.44)] p-4 text-sm text-[var(--color-copy)]">
                        正在读取 Pi runtime 状态...
                    </div>
                ) : (
                    <div className="mt-4 space-y-4 text-sm leading-6 text-[var(--color-copy)]">
                        <div className="flex flex-wrap gap-2">
                            <Badge tone={piStatus.state === 'ready' ? 'accent' : 'default'}>{piStatus.state}</Badge>
                            <Badge tone={piStatus.financeTools.available ? 'accent' : 'default'}>{piStatus.financeTools.available ? 'Finance Tools 可用' : 'Finance Tools 异常'}</Badge>
                            <Badge tone={piRiskGateState?.acknowledged ? 'accent' : 'default'}>{piRiskGateState?.acknowledged ? '高权限已确认' : '高权限待确认'}</Badge>
                        </div>

                        <div className="grid gap-4 xl:grid-cols-2">
                            <div className="rounded-[16px] border border-[color:var(--color-border)] bg-[rgba(244,239,230,0.44)] p-4">
                                <p>Session Count：{piStatus.sessionCount}</p>
                                <p>Model：{piStatus.model.model ?? '未解析'}</p>
                                <p>Provider：{piStatus.model.provider ?? '未解析'}</p>
                                <p>PID：{piStatus.pid ?? 'n/a'}</p>
                                <p>Last Started：{piStatus.lastStartedAt ?? 'n/a'}</p>
                                <p>Last Error：{piStatus.lastError ?? '无'}</p>
                            </div>

                            <div className="rounded-[16px] border border-[color:var(--color-border)] bg-[rgba(244,239,230,0.44)] p-4" data-testid="settings-pi-diagnostics-list">
                                <p>Finance Tools：{piStatus.financeTools.names.join(', ') || '无'}</p>
                                <p>Finance Error：{piStatus.financeTools.lastError ?? '无'}</p>
                                <p>Degraded：{piStatus.degraded ? 'true' : 'false'}</p>
                                <p>Degraded Reason：{piStatus.degradedReason ?? '无'}</p>
                                <p>Diagnostics：{piStatus.diagnostics.map((item) => `${item.level}:${item.source}`).join(', ') || '无'}</p>
                            </div>
                        </div>

                        <div className="grid gap-3 xl:grid-cols-2">
                            {([
                                ['agentDir', '配置目录', piStatus.directories.agentDir],
                                ['sessionDir', '会话目录', piStatus.directories.sessionDir],
                                ['toolInvocationDir', '工具调用目录', piStatus.directories.toolInvocationDir],
                                ['workspaceDir', '工作目录', piStatus.directories.workspaceDir],
                            ] as Array<[PiRuntimeDirectoryTarget, string, string]>).map(([target, label, pathValue]) => (
                                <article className="rounded-[16px] border border-[color:var(--color-border)] bg-[rgba(255,255,255,0.62)] p-4" key={target}>
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-muted)]">{label}</p>
                                            <p className="mt-2 break-all text-sm leading-6 text-[var(--color-copy)]">{pathValue}</p>
                                        </div>
                                        <Button onClick={() => { void openPiDirectory(target); }} size="sm" tone="ghost">打开</Button>
                                    </div>
                                </article>
                            ))}
                        </div>
                    </div>
                )}
            </section>

            <div className="grid gap-4 xl:grid-cols-2">
                <PreferencesSummarySection
                    dataSourceSummary={dataSourceSummary}
                    onOpenPreferencesModal={handleOpenPreferencesModal}
                    preferencesDraft={preferencesDraft}
                />
                <CacheSummarySection
                    cacheSummary={cacheSummary}
                    onClearCache={handleClearCache}
                    onRefresh={handleReloadSettings}
                    syncStatus={syncStatus}
                />
            </div>

            <RuntimeSummarySection
                browserLiveConfig={browserLiveConfig}
                isValidatingSidecar={isValidatingSidecar}
                onOpenLogDirectory={handleOpenLogDirectory}
                onSidecarUrlChange={setSidecarUrlDraft}
                onValidateSidecar={handleValidateSidecarConnection}
                runtimeMode={runtimeMode}
                runtimeStatus={runtimeStatus}
                sidecarUrlDraft={sidecarUrlDraft}
            />

            <PreferencesEditModal
                isSavingPreferences={isSavingPreferences}
                onClose={handleClosePreferencesModal}
                onSave={handleSavePreferences}
                open={isPreferencesModalOpen}
                preferencesDraft={preferencesDraft}
                setPreferencesDraft={setPreferencesDraft}
            />

            <div className="sr-only" data-testid="settings-runtime-mode">{runtimeMode}</div>
            <div className="sr-only" data-testid="settings-loading-state">{isLoading ? '1' : '0'}</div>
            <div className="sr-only" data-testid="settings-pi-runtime-state">{piStatus?.state ?? ''}</div>
            <div className="sr-only" data-testid="settings-pi-risk-acknowledged">{piRiskGateState?.acknowledged ? '1' : '0'}</div>
        </section>
    );
};