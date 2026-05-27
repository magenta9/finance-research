import type { TextareaHTMLAttributes } from 'react';

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = ({ className = '', rows = 4, ...props }: TextareaProps) => (
    <textarea
        className={[
            'w-full rounded-[18px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 py-3 text-sm leading-6 text-[var(--color-foreground)] shadow-none outline-none transition placeholder:text-[var(--color-muted)] focus:border-[var(--color-highlight-soft)] focus:bg-[rgba(255,255,255,0.05)] disabled:cursor-not-allowed disabled:opacity-60',
            className,
        ].join(' ')}
        rows={rows}
        {...props}
    />
);