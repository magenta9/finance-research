import { memo, useEffect, useMemo, useState } from 'react';

import type { PiSkillSummary, PiStagedAttachment } from '@quantdesk/shared';

import { Button } from '../button';
import { Textarea } from '../textarea';

const formatAttachmentSize = (size: number) => {
    if (size >= 1024 * 1024) {
        return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    }

    if (size >= 1024) {
        return `${Math.ceil(size / 1024)} KB`;
    }

    return `${size} B`;
};

interface PiComposerProps {
    attachments?: PiStagedAttachment[];
    draft: string;
    isSending: boolean;
    isStagingAttachments?: boolean;
    onAcknowledgeRisk: () => void;
    onAttachFiles?: () => void;
    onCancel: () => void;
    onDraftChange: (value: string) => void;
    onRemoveAttachment?: (attachmentId: string) => void;
    onSend: () => void;
    riskAcknowledged: boolean;
    riskNotice?: string;
    skills?: PiSkillSummary[];
}

const skillCommandPrefix = 'skill:';

const normalizeSkillQuery = (value: string) => value.trim().replace(/^\/+/, '').replace(/^skill:/, '').toLowerCase();

const getSlashSkillQuery = (draft: string) => {
    const match = draft.match(/^\/([^\s]*)$/);
    return match ? match[1] : null;
};

const filterSkillSuggestions = (skills: PiSkillSummary[], query: string) => {
    const normalizedQuery = normalizeSkillQuery(query);

    return skills
        .filter((skill) => {
            if (!normalizedQuery) {
                return true;
            }

            const haystack = `${skill.name} ${skill.description ?? ''}`.toLowerCase();
            return haystack.includes(normalizedQuery);
        })
        .slice(0, 6);
};

export const PiComposer = memo(({
    attachments = [],
    draft,
    isSending,
    isStagingAttachments = false,
    onAcknowledgeRisk,
    onAttachFiles,
    onCancel,
    onDraftChange,
    onRemoveAttachment,
    onSend,
    riskAcknowledged,
    riskNotice,
    skills = [],
}: PiComposerProps) => {
    const canSend = draft.trim().length > 0 || attachments.length > 0;
    const slashSkillQuery = getSlashSkillQuery(draft);
    const skillSuggestions = useMemo(
        () => slashSkillQuery === null ? [] : filterSkillSuggestions(skills, slashSkillQuery),
        [skills, slashSkillQuery],
    );
    const [selectedSkillIndex, setSelectedSkillIndex] = useState(0);
    const selectedSkill = skillSuggestions[Math.min(selectedSkillIndex, Math.max(0, skillSuggestions.length - 1))] ?? null;

    useEffect(() => {
        setSelectedSkillIndex(0);
    }, [slashSkillQuery]);

    const completeSelectedSkill = () => {
        if (!selectedSkill) {
            return false;
        }

        onDraftChange(`/${skillCommandPrefix}${selectedSkill.name} `);
        return true;
    };

    return (
        <div className="relative rounded-[14px] border border-[color:var(--color-border)] bg-[rgba(255,255,255,0.42)] p-2">
            {attachments.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                    {attachments.map((attachment) => (
                        <span
                            className="inline-flex max-w-full items-center gap-2 rounded-[10px] border border-[rgba(62,49,37,0.14)] bg-[rgba(255,255,255,0.66)] px-2.5 py-1 text-xs text-[var(--color-copy)]"
                            key={attachment.id}
                            title={attachment.name}
                        >
                            <span aria-hidden="true" className="text-[11px] text-[var(--color-muted)]">{attachment.kind === 'image' ? 'IMG' : 'DOC'}</span>
                            <span className="max-w-[12rem] truncate">{attachment.name}</span>
                            <span className="shrink-0 text-[var(--color-muted)]">{formatAttachmentSize(attachment.size)}</span>
                            {onRemoveAttachment && !isSending && (
                                <Button
                                    aria-label={`移除附件 ${attachment.name}`}
                                    className="size-5 shrink-0 rounded-full border-transparent px-0 text-[13px] text-[var(--color-muted)] shadow-none hover:bg-[rgba(62,49,37,0.08)] hover:text-[var(--color-copy)]"
                                    onClick={() => { onRemoveAttachment(attachment.id); }}
                                    size="sm"
                                    title="移除附件"
                                    tone="ghost"
                                    type="button"
                                >
                                    x
                                </Button>
                            )}
                        </span>
                    ))}
                </div>
            )}
            <div className="flex flex-col gap-2 xl:flex-row xl:items-end">
                <Textarea
                    className="min-h-[44px] flex-1 resize-none rounded-[12px] px-3 py-2 text-sm leading-6"
                    data-testid="pi-agent-message-input"
                    disabled={isSending}
                    onChange={(event) => {
                        onDraftChange(event.currentTarget.value);
                    }}
                    onKeyDown={(event) => {
                        if (slashSkillQuery !== null && skillSuggestions.length > 0) {
                            if (event.key === 'ArrowDown') {
                                event.preventDefault();
                                setSelectedSkillIndex((current) => (current + 1) % skillSuggestions.length);
                                return;
                            }

                            if (event.key === 'ArrowUp') {
                                event.preventDefault();
                                setSelectedSkillIndex((current) => (current - 1 + skillSuggestions.length) % skillSuggestions.length);
                                return;
                            }

                            if (event.key === 'Tab') {
                                event.preventDefault();
                                completeSelectedSkill();
                                return;
                            }
                        }

                        if (event.key !== 'Enter' || !event.shiftKey) {
                            return;
                        }

                        event.preventDefault();

                        if (slashSkillQuery !== null && skillSuggestions.length > 0 && completeSelectedSkill()) {
                            return;
                        }

                        if (isSending) {
                            onCancel();
                            return;
                        }

                        if (riskAcknowledged && canSend) {
                            onSend();
                        }
                    }}
                    placeholder="例如：总结今天的市场新闻，或解释刚才那次工具调用。"
                    rows={1}
                    value={draft}
                />
                {slashSkillQuery !== null && (
                    <div className="rounded-[12px] border border-[rgba(62,49,37,0.12)] bg-[rgba(255,252,248,0.96)] p-1.5 shadow-[0_14px_32px_rgba(61,43,31,0.12)] xl:absolute xl:bottom-[4.25rem] xl:left-2 xl:w-[min(520px,calc(100%-210px))]" data-testid="pi-agent-skill-suggestions">
                        {skillSuggestions.length === 0 ? (
                            <div className="px-2.5 py-2 text-xs text-[var(--color-muted)]">未找到匹配的 Pi skill</div>
                        ) : skillSuggestions.map((skill, index) => (
                            <Button
                                className={[
                                    'flex h-auto w-full items-start justify-start gap-2 rounded-[9px] border-transparent bg-transparent px-2.5 py-2 text-left shadow-none transition hover:border-transparent',
                                    index === selectedSkillIndex ? 'bg-[rgba(156,98,55,0.12)]' : 'hover:bg-[rgba(62,49,37,0.06)]',
                                ].join(' ')}
                                data-testid={`pi-agent-skill-suggestion-${skill.name}`}
                                key={skill.name}
                                onMouseDown={(event) => {
                                    event.preventDefault();
                                    onDraftChange(`/${skillCommandPrefix}${skill.name} `);
                                }}
                                size="none"
                                tone="ghost"
                                type="button"
                            >
                                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[7px] border border-[rgba(156,98,55,0.16)] bg-[rgba(248,243,235,0.8)] font-mono text-[9px] font-semibold text-[var(--color-highlight)]">/</span>
                                <span className="min-w-0">
                                    <span className="block truncate text-xs font-semibold text-[var(--color-foreground)]">/{skillCommandPrefix}{skill.name}</span>
                                    <span className="mt-0.5 block truncate text-[11px] leading-4 text-[var(--color-muted)]">{skill.description ?? skill.source}</span>
                                </span>
                            </Button>
                        ))}
                    </div>
                )}
                <div className="flex w-full gap-2 xl:w-[180px]">
                    <Button
                        aria-label="添加附件"
                        className="h-10 w-10 shrink-0 rounded-[12px] px-0"
                        data-testid="pi-agent-attach-button"
                        disabled={isSending || isStagingAttachments || !riskAcknowledged}
                        onClick={onAttachFiles}
                        title="添加附件"
                        type="button"
                    >
                        {isStagingAttachments ? '...' : '+'}
                    </Button>
                    {riskAcknowledged ? (
                        <Button
                            className="h-10 flex-1 rounded-[12px]"
                            data-testid="pi-agent-send-button"
                            disabled={!isSending && !canSend}
                            onClick={isSending ? onCancel : onSend}
                            tone={isSending ? 'danger' : 'primary'}
                        >
                            {isSending ? '停止' : '发送'}
                        </Button>
                    ) : (
                        <Button
                            aria-label={riskNotice ? `确认风险：${riskNotice}` : '确认风险'}
                            className="h-10 flex-1 rounded-[12px]"
                            data-testid="pi-agent-ack-risk"
                            onClick={onAcknowledgeRisk}
                            title={riskNotice}
                            tone="danger"
                            type="button"
                        >
                            确认风险
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
});

PiComposer.displayName = 'PiComposer';
