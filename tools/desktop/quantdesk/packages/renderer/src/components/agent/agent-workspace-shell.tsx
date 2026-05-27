import { useState } from 'react';
import type { ReactNode, RefObject } from 'react';

import { Badge } from '../badge';
import { Button } from '../button';

interface WorkspaceStatusItem {
    label: string;
    tone?: 'default' | 'accent' | 'muted' | 'danger';
}

interface WorkspaceAction {
    label: string;
    onClick: () => void;
    testId?: string;
    tone?: 'primary' | 'secondary' | 'ghost' | 'danger';
}

interface WorkspaceSidebarSection {
    content: ReactNode;
    eyebrow?: string;
    icon?: 'context' | 'stats' | 'tools';
    compact?: boolean;
    title: string;
}

interface AgentWorkspaceShellProps {
    actions: WorkspaceAction[];
    children: ReactNode;
    conversationButtonLabel: string;
    conversationMeta: string;
    conversationButtonRef?: RefObject<HTMLButtonElement | null>;
    historyOverlayControlsId?: string;
    historyOverlayOpen: boolean;
    onToggleHistoryOverlay: () => void;
    rightSidebarSections: WorkspaceSidebarSection[];
    runtimeLabel: string;
    statusItems: WorkspaceStatusItem[];
}

const SidebarIcon = ({ icon }: { icon?: WorkspaceSidebarSection['icon'] }) => {
    if (icon === 'stats') {
        return (
            <svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 24 24">
                <path d="M5 19V11M12 19V5M19 19v-8" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
            </svg>
        );
    }

    if (icon === 'tools') {
        return (
            <svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 24 24">
                <path d="M6 6h5v5H6zM13 6h5v5h-5zM6 13h5v5H6zM13 13h5v5h-5z" fill="none" stroke="currentColor" strokeWidth="1.6" />
            </svg>
        );
    }

    return (
        <svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 24 24">
            <path d="M5 7.5h14M5 12h14M5 16.5h9" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
        </svg>
    );
};

const SidebarCard = ({
    content,
    eyebrow,
    icon,
    title,
}: WorkspaceSidebarSection) => (
    <section className="border-t border-[rgba(70,53,43,0.08)] pt-2 first:border-t-0 first:pt-0">
        <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[8px] border border-[rgba(156,98,55,0.12)] bg-[rgba(248,243,235,0.68)] text-[var(--color-highlight)]">
                <SidebarIcon icon={icon} />
            </div>
            <div className="min-w-0">
                <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--color-muted)]">{eyebrow ?? '侧栏'}</p>
                <h3 className="truncate text-xs font-semibold leading-4 text-[var(--color-foreground)]">{title}</h3>
            </div>
        </div>
        <div className="mt-1.5">{content}</div>
    </section>
);

export const AgentWorkspaceShell = ({
    actions,
    children,
    conversationButtonLabel,
    conversationMeta,
    conversationButtonRef,
    historyOverlayControlsId,
    historyOverlayOpen,
    onToggleHistoryOverlay,
    rightSidebarSections,
    runtimeLabel,
    statusItems,
}: AgentWorkspaceShellProps) => {
    const [infoOpen, setInfoOpen] = useState(false);

    return (
        <section className="flex h-full min-h-0 flex-col gap-2 overflow-hidden" data-testid="agent-workspace-shell">
            <section
                className="relative z-30 overflow-visible rounded-[16px] border border-[color:var(--color-border)] bg-[rgba(255,252,248,0.92)] p-2 shadow-[0_10px_26px_rgba(61,43,31,0.05)]"
                data-testid="agent-workspace-toolbar"
            >
                <div className="relative flex flex-col gap-2.5">
                    <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
                        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                            <Button
                                className="h-8 min-w-0 max-w-[28rem] justify-between rounded-[11px] px-3 text-left"
                                data-testid="agent-open-history-overlay"
                                aria-haspopup="dialog"
                                aria-expanded={historyOverlayOpen}
                                aria-controls={historyOverlayControlsId}
                                onClick={onToggleHistoryOverlay}
                                ref={conversationButtonRef}
                                tone="secondary"
                                type="button"
                            >
                                <span className="min-w-0 truncate">{conversationButtonLabel}</span>
                                <span aria-hidden="true" className={['font-mono text-[10px] transition-transform duration-200', historyOverlayOpen ? 'rotate-180' : ''].join(' ')}>⌄</span>
                            </Button>
                            <Button className="h-8 rounded-[11px] px-3" data-testid="agent-new-conversation" onClick={actions[0]?.onClick} tone="primary" type="button">
                                {actions[0]?.label}
                            </Button>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                            <Button
                                aria-expanded={infoOpen}
                                className="h-8 rounded-[11px] px-3"
                                data-testid="agent-workspace-info-toggle"
                                onClick={() => { setInfoOpen((current) => !current); }}
                                tone="secondary"
                                type="button"
                            >
                                <span>信息</span>
                                <span aria-hidden="true" className={['font-mono text-[10px] transition-transform duration-200', infoOpen ? 'rotate-180' : ''].join(' ')}>⌄</span>
                            </Button>
                        </div>
                    </div>

                    {infoOpen && (
                        <section className="absolute right-0 top-[calc(100%+0.5rem)] z-40 grid max-h-[min(58vh,420px)] w-full max-w-[360px] gap-2 overflow-y-auto rounded-[14px] border border-[color:var(--color-border)] bg-[rgba(255,252,248,0.98)] p-2.5 shadow-[0_20px_48px_rgba(61,43,31,0.13)] backdrop-blur" data-testid="agent-workspace-info-panel">
                            <section className="border-b border-[rgba(70,53,43,0.08)] pb-2">
                                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-muted)]">运行信息</p>
                                <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                                    <Badge className="tracking-[0]" tone="accent">{runtimeLabel}</Badge>
                                    {statusItems.map((item) => (
                                        <Badge className="tracking-[0]" key={item.label} tone={item.tone ?? 'default'}>
                                            {item.label}
                                        </Badge>
                                    ))}
                                    <Badge className="tracking-[0]">{conversationMeta}</Badge>
                                </div>
                                {actions.slice(1).length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                        {actions.slice(1).map((action) => (
                                            <Button
                                                data-testid={action.testId}
                                                key={action.label}
                                                onClick={action.onClick}
                                                size="sm"
                                                tone={action.tone ?? 'ghost'}
                                                type="button"
                                            >
                                                {action.label}
                                            </Button>
                                        ))}
                                    </div>
                                )}
                            </section>
                            {rightSidebarSections.map((section) => (
                                <SidebarCard content={section.content} eyebrow={section.eyebrow} icon={section.icon} key={section.title} title={section.title} />
                            ))}
                        </section>
                    )}
                </div>
            </section>

            <section className="min-h-0 flex-1 overflow-hidden">
                <div className="h-full min-h-0 min-w-0 overflow-hidden">{children}</div>
            </section>
        </section>
    );
};
