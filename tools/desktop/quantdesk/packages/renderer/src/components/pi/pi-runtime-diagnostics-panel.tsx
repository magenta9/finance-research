import type {
    PiRiskGateState,
    PiRuntimeDirectoryTarget,
    PiRuntimeStatus,
} from '@quantdesk/shared';

import { Badge } from '../badge';
import { Button } from '../button';
import { useOverlayFocusTrap } from '../use-overlay-focus-trap';

interface PiRuntimeDiagnosticsPanelProps {
    onAcknowledgeRisk: () => void;
    onClose: () => void;
    onOpenDirectory: (target: PiRuntimeDirectoryTarget) => void;
    onRefresh: () => void;
    open: boolean;
    riskGateState: PiRiskGateState | null;
    runtimeStatus: PiRuntimeStatus | null;
}

const formatTimestamp = (value: string | null | undefined) => (
    value ? value.slice(0, 19).replace('T', ' ') : '未知'
);

const runtimeStateLabel: Record<string, string> = {
    degraded: '受限',
    error: '异常',
    idle: '空闲',
    ready: '已就绪',
    starting: '启动中',
};

const formatRuntimeState = (state?: string | null) => (
    state ? (runtimeStateLabel[state] ?? state) : '未加载'
);

const StatCard = ({ label, value }: { label: string; value: string }) => (
    <article className="rounded-[16px] border border-[color:var(--color-border)] bg-[rgba(255,255,255,0.03)] p-3">
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-[var(--color-muted)]">{label}</p>
        <p className="mt-2 text-sm leading-6 text-[var(--color-copy)]">{value}</p>
    </article>
);

export const PiRuntimeDiagnosticsPanel = ({
    onAcknowledgeRisk,
    onClose,
    onOpenDirectory,
    onRefresh,
    open,
    riskGateState,
    runtimeStatus,
}: PiRuntimeDiagnosticsPanelProps) => {
    const dialogRef = useOverlayFocusTrap<HTMLElement>(open, onClose);

    return (
        <div
            aria-hidden={!open}
            className={[
                'fixed inset-0 z-50 flex justify-end transition-[visibility] duration-300',
                open ? 'visible pointer-events-auto' : 'invisible pointer-events-none',
            ].join(' ')}
        >
            <Button
                aria-label="关闭 Agent 运行诊断面板"
                className={[
                    'absolute inset-0 h-full w-full rounded-none border-0 bg-[rgba(23,19,16,0.42)] px-0 py-0 shadow-none backdrop-blur-[2px] transition-opacity duration-300 hover:bg-[rgba(23,19,16,0.42)]',
                    open ? 'opacity-100' : 'opacity-0',
                ].join(' ')}
                onClick={onClose}
                size="sm"
                tabIndex={open ? 0 : -1}
                tone="ghost"
                type="button"
            >
                <span className="sr-only">关闭 Agent 运行诊断面板</span>
            </Button>

            <aside
                aria-label="Agent 运行与目录状态面板"
                aria-modal="true"
                className={[
                    'relative flex h-full w-full max-w-[760px] flex-col overflow-hidden border-l border-[color:var(--color-border)] bg-[linear-gradient(180deg,rgba(14,17,23,0.98),rgba(8,10,15,0.98))] shadow-[-36px_0_96px_rgba(0,0,0,0.28)] transition-transform duration-300 ease-out',
                    open ? 'translate-x-0' : 'translate-x-full',
                ].join(' ')}
                data-testid="pi-agent-runtime-diagnostics"
                ref={dialogRef}
                role="dialog"
                tabIndex={-1}
            >
                <div className="relative flex-1 overflow-y-auto px-4 pb-6 pt-4 sm:px-5 lg:px-6" data-agent-scroll="1">
                    <section className="rounded-[22px] border border-[color:var(--color-border)] bg-[rgba(255,255,255,0.03)] p-4">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--color-muted)]">状态面板</p>
                                <h2 className="mt-2 text-[1.8rem] font-semibold leading-none text-[var(--color-foreground)] sm:text-[2.1rem]">
                                    Agent 运行与目录
                                </h2>
                                <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-copy)]">
                                    目录、工具和告警都放在这里，不打断正文。
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                <Button data-testid="pi-agent-refresh-diagnostics" onClick={onRefresh} size="sm" tone="secondary">
                                    刷新
                                </Button>
                                <Button
                                    aria-label="关闭 Agent 运行诊断面板"
                                    className="h-11 w-11 rounded-full px-0 text-lg"
                                    onClick={onClose}
                                    size="sm"
                                    tone="ghost"
                                    type="button"
                                >
                                    ×
                                </Button>
                            </div>
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                            <Badge tone={runtimeStatus?.state === 'ready' ? 'accent' : runtimeStatus?.state === 'error' ? 'danger' : runtimeStatus?.state === 'degraded' ? 'muted' : 'default'}>{formatRuntimeState(runtimeStatus?.state)}</Badge>
                            <Badge className="normal-case tracking-[0.08em]">{runtimeStatus?.model.model ?? '未解析模型'}</Badge>
                            <Badge tone={runtimeStatus?.financeTools.available ? 'accent' : 'default'}>
                                {runtimeStatus?.financeTools.available ? '工具可用' : '工具异常'}
                            </Badge>
                            <Badge tone={riskGateState?.acknowledged ? 'accent' : 'default'}>
                                {riskGateState?.acknowledged ? '已确认权限' : '待确认权限'}
                            </Badge>
                        </div>
                    </section>

                    {!riskGateState?.acknowledged && (
                        <section className="mt-5 rounded-[20px] border border-[rgba(255,108,87,0.24)] bg-[rgba(255,108,87,0.08)] p-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <p className="font-mono text-xs uppercase tracking-[0.26em] text-[#ffb2a6]">权限提醒</p>
                                    <h3 className="mt-1.5 text-lg font-semibold text-[#ffe0da]">发送前先确认高权限</h3>
                                </div>
                                <Button data-testid="pi-agent-diagnostics-ack-risk" onClick={onAcknowledgeRisk} tone="danger">
                                    确认风险
                                </Button>
                            </div>
                            <p className="mt-3 text-sm leading-6 text-[#ffcabf]">{riskGateState?.message ?? 'Agent 可以读写本地文件并执行命令。'}</p>
                        </section>
                    )}

                    <div className="mt-5 grid gap-5 xl:grid-cols-2">
                        <section className="space-y-4 rounded-[22px] border border-[color:var(--color-border)] bg-[rgba(255,255,255,0.03)] p-4">
                            <div>
                                <p className="font-mono text-xs uppercase tracking-[0.26em] text-[var(--color-muted)]">当前状态</p>
                                <h3 className="mt-2 text-2xl font-semibold text-[var(--color-foreground)]">当前状态</h3>
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2">
                                <StatCard label="进程号" value={String(runtimeStatus?.pid ?? 'n/a')} />
                                <StatCard label="会话数" value={String(runtimeStatus?.sessionCount ?? 0)} />
                                <StatCard label="上次启动" value={formatTimestamp(runtimeStatus?.lastStartedAt)} />
                                <StatCard label="上次检查" value={formatTimestamp(runtimeStatus?.lastCheckedAt)} />
                                <StatCard label="模型来源" value={runtimeStatus?.model.provider ?? '未解析'} />
                                <StatCard label="最近错误" value={runtimeStatus?.lastError ?? '无'} />
                            </div>
                        </section>

                        <section className="space-y-4 rounded-[22px] border border-[color:var(--color-border)] bg-[rgba(255,255,255,0.03)] p-4">
                            <div>
                                <p className="font-mono text-xs uppercase tracking-[0.26em] text-[var(--color-muted)]">常用目录</p>
                                <h3 className="mt-2 text-2xl font-semibold text-[var(--color-foreground)]">常用目录</h3>
                            </div>
                            <div className="grid gap-3">
                                {([
                                    ['agentDir', '配置目录', runtimeStatus?.directories.agentDir ?? '未解析'],
                                    ['sessionDir', '会话目录', runtimeStatus?.directories.sessionDir ?? '未解析'],
                                    ['toolInvocationDir', '工具调用目录', runtimeStatus?.directories.toolInvocationDir ?? '未解析'],
                                    ['workspaceDir', '工作目录', runtimeStatus?.directories.workspaceDir ?? '未解析'],
                                ] as Array<[PiRuntimeDirectoryTarget, string, string]>).map(([target, label, value]) => (
                                    <article className="rounded-[16px] border border-[color:var(--color-border)] bg-[rgba(255,255,255,0.03)] p-3" key={target}>
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="font-mono text-xs uppercase tracking-[0.22em] text-[var(--color-muted)]">{label}</p>
                                                <p className="mt-2 break-all text-sm leading-6 text-[var(--color-copy)]">{value}</p>
                                            </div>
                                            <Button onClick={() => { onOpenDirectory(target); }} size="sm" tone="ghost">
                                                打开
                                            </Button>
                                        </div>
                                    </article>
                                ))}
                            </div>
                        </section>
                    </div>

                    <section className="mt-5 rounded-[22px] border border-[color:var(--color-border)] bg-[rgba(255,255,255,0.03)] p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <p className="font-mono text-xs uppercase tracking-[0.26em] text-[var(--color-muted)]">工具与告警</p>
                                <h3 className="mt-2 text-2xl font-semibold text-[var(--color-foreground)]">工具与告警</h3>
                            </div>
                            <Badge tone={runtimeStatus?.financeTools.available ? 'accent' : 'default'}>
                                {runtimeStatus?.financeTools.names.length ?? 0} 项工具
                            </Badge>
                        </div>
                        <div className="mt-4 grid gap-4 xl:grid-cols-2">
                            <div className="rounded-[16px] border border-[color:var(--color-border)] bg-[rgba(255,255,255,0.03)] p-3 text-sm leading-6 text-[var(--color-copy)]">
                                <p>工具清单：{runtimeStatus?.financeTools.names.join(', ') || '无'}</p>
                                <p>工具错误：{runtimeStatus?.financeTools.lastError ?? '无'}</p>
                                <p>当前受限：{runtimeStatus?.degraded ? '是' : '否'}</p>
                                <p>受限原因：{runtimeStatus?.degradedReason ?? '无'}</p>
                            </div>
                            <div className="rounded-[16px] border border-[color:var(--color-border)] bg-[rgba(255,255,255,0.03)] p-3 text-sm leading-6 text-[var(--color-copy)]" data-testid="pi-agent-diagnostics-list">
                                {(runtimeStatus?.diagnostics.length ?? 0) === 0 ? (
                                    <p>当前没有额外告警。</p>
                                ) : (
                                    runtimeStatus?.diagnostics.map((diagnostic, index) => (
                                        <p key={`${diagnostic.source}-${index}`}>
                                            [{diagnostic.level}] {diagnostic.source}: {diagnostic.message}
                                        </p>
                                    ))
                                )}
                            </div>
                        </div>
                    </section>
                </div>
            </aside>
        </div>
    );
};