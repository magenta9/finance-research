import { memo, type ReactNode } from 'react';

import type {
  RuntimeConfig,
  RuntimeMode,
  RuntimeStatusResponse,
} from '@quantdesk/shared/types/system';

import { Button } from '../../components/button';
import { Input } from '../../components/input';
import { formatMetadataBackfillSummary, type PreferencesDraft } from './settings-types';

const SettingsMetricCardComponent = ({ detail, label, value }: { detail: string; label: string; value: string }) => (
  <article className="min-w-0 overflow-hidden rounded-[16px] border border-[color:var(--color-border)] bg-[rgba(255,255,255,0.62)] p-3 shadow-[0_10px_26px_rgba(61,43,31,0.04)]">
    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">{label}</p>
    <p className="mt-2 truncate font-display text-2xl leading-7 text-[var(--color-foreground)]">{value}</p>
    <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--color-copy)]">{detail}</p>
  </article>
);

export const SettingsMetricCard = memo(SettingsMetricCardComponent);

SettingsMetricCard.displayName = 'SettingsMetricCard';

const SectionCard = ({
  actions,
  children,
  eyebrow,
  testId,
  title,
}: {
  actions?: ReactNode;
  children: ReactNode;
  eyebrow: string;
  testId?: string;
  title: string;
}) => (
  <section className="rounded-[20px] border border-[color:var(--color-border)] bg-[rgba(255,252,248,0.78)] p-4 shadow-[0_12px_32px_rgba(61,43,31,0.05)]" data-testid={testId}>
    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-[var(--color-muted)]">{eyebrow}</p>
        <h2 className="mt-2 font-display text-2xl text-[var(--color-foreground)]">{title}</h2>
      </div>
      {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
    </div>
    <div className="mt-4">{children}</div>
  </section>
);

const PreferencesSummarySectionComponent = ({
  dataSourceSummary,
  onOpenPreferencesModal,
  preferencesDraft,
}: {
  dataSourceSummary: string;
  onOpenPreferencesModal: () => void;
  preferencesDraft: PreferencesDraft;
}) => (
  <SectionCard
    actions={<Button data-testid="settings-open-preferences-modal" onClick={onOpenPreferencesModal} tone="secondary">编辑偏好</Button>}
    eyebrow="偏好设置"
    testId="settings-preferences-section"
    title="默认市场、基准货币与数据源"
  >
    <div className="rounded-[16px] border border-[color:var(--color-border)] bg-[rgba(244,239,230,0.44)] p-4 text-sm leading-6 text-[var(--color-copy)]">
      <p>基准货币：{preferencesDraft.baseCurrency}</p>
      <p>默认市场：{preferencesDraft.defaultMarket}</p>
      <p>语言：{preferencesDraft.language}</p>
      <p>默认单标的上限：{preferencesDraft.defaultMaxSingleWeight}</p>
      <p>数据源：{dataSourceSummary}</p>
    </div>
  </SectionCard>
);

export const PreferencesSummarySection = memo(PreferencesSummarySectionComponent);

PreferencesSummarySection.displayName = 'PreferencesSummarySection';

const RuntimeSummarySectionComponent = ({
  browserLiveConfig,
  isValidatingSidecar,
  onOpenLogDirectory,
  onSidecarUrlChange,
  onValidateSidecar,
  runtimeMode,
  runtimeStatus,
  sidecarUrlDraft,
}: {
  browserLiveConfig: RuntimeConfig;
  isValidatingSidecar: boolean;
  onOpenLogDirectory: () => void;
  onSidecarUrlChange: (value: string) => void;
  onValidateSidecar: () => void;
  runtimeMode: RuntimeMode;
  runtimeStatus: RuntimeStatusResponse | null;
  sidecarUrlDraft: string;
}) => (
  <SectionCard
    actions={<Button onClick={onOpenLogDirectory} tone="ghost">打开日志目录</Button>}
    eyebrow="Data Runtime"
    testId="settings-runtime-section"
    title="quant-data、Sidecar 与 browser-live 连接"
  >
    <div className="space-y-4 text-sm leading-6 text-[var(--color-copy)]">
      <div className="rounded-[16px] border border-[color:var(--color-border)] bg-[rgba(244,239,230,0.44)] p-4">
        <p data-testid="settings-quant-data-provider-status">quant-data Provider：{runtimeStatus?.quantData?.providerConfiguration.ready ? 'ready' : (runtimeStatus?.quantData?.providerConfiguration.code ?? 'unavailable')}</p>
        <p>quant-data Message：{runtimeStatus?.quantData?.providerConfiguration.message ?? runtimeStatus?.quantData?.lastError ?? '无'}</p>
        <p>quant-data Store：{runtimeStatus?.quantData?.storePath ?? 'n/a'}</p>
        <p>Sidecar Ready：{runtimeStatus?.sidecarReady ? 'true' : 'false'}</p>
        <p>PID：{runtimeStatus?.sidecarPid ?? 'n/a'}</p>
        <p>Port：{runtimeStatus?.sidecarPort ?? 'n/a'}</p>
        <p>Last Error：{runtimeStatus?.lastError ?? '无'}</p>
        <p>日志目录：{runtimeStatus?.logDir ?? '日志目录不可用'}</p>
        <p data-testid="settings-metadata-backfill-summary">Metadata 扫描：{formatMetadataBackfillSummary(runtimeStatus)}</p>
      </div>

      {runtimeMode === 'browser-live' ? (
        <div className="rounded-[16px] border border-[color:var(--color-border)] bg-[rgba(255,255,255,0.62)] p-4">
          <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-muted)]">Browser Live 连接</p>
          <label className="mt-3 block space-y-2">
            <span className="text-xs uppercase tracking-[0.22em] text-[var(--color-muted)]">Sidecar WebSocket URL</span>
            <Input
              className="h-10 w-full rounded-[12px] border border-[color:var(--color-border)] bg-white/88 px-3"
              data-testid="settings-browser-sidecar-url"
              onChange={(event) => { onSidecarUrlChange(event.currentTarget.value); }}
              value={sidecarUrlDraft}
            />
          </label>
          <p className="mt-3">最近成功连接：{browserLiveConfig.lastConnectedAt ?? '无'}</p>
          <p data-testid="settings-browser-live-error">最近初始化 / 连接错误：{browserLiveConfig.lastInitializationError ?? browserLiveConfig.lastConnectionError ?? '无'}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button data-testid="settings-browser-validate-sidecar" onClick={onValidateSidecar} tone="primary">
              {isValidatingSidecar ? '验证中...' : '验证 sidecar 连接'}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  </SectionCard>
);

export const RuntimeSummarySection = memo(RuntimeSummarySectionComponent);

RuntimeSummarySection.displayName = 'RuntimeSummarySection';