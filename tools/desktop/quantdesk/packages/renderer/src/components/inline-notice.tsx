import type { ReactNode } from 'react';

import { Button } from './button';

interface InlineNoticeProps {
    message: ReactNode;
    messageTestId?: string;
    onDismiss: () => void;
    tone?: 'default' | 'danger';
}

export const InlineNotice = ({
    message,
    messageTestId,
    onDismiss,
    tone = 'default',
}: InlineNoticeProps) => (
    <div className={[
        'flex items-start justify-between gap-4 rounded-[22px] border p-4 text-sm leading-6',
        tone === 'danger'
            ? 'border-[rgba(159,58,41,0.18)] bg-[rgba(159,58,41,0.06)] text-[#7d2c22]'
            : 'border-[color:var(--color-highlight-soft)] bg-[rgba(156,98,55,0.08)] text-[var(--color-foreground)]',
    ].join(' ')}>
        <p data-testid={messageTestId}>{message}</p>
        <Button
            className="h-auto border-0 px-0 text-xs uppercase tracking-[0.18em] shadow-none hover:bg-transparent"
            onClick={onDismiss}
            size="sm"
            tone="ghost"
            type="button"
        >
            关闭
        </Button>
    </div>
);