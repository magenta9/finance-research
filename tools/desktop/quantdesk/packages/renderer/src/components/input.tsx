import type { InputHTMLAttributes } from 'react';

type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = ({ className = '', type = 'text', ...props }: InputProps) => (
    <input
        className={[
            'h-10 w-full rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3.5 text-sm text-[var(--color-foreground)] shadow-none outline-none transition placeholder:text-[var(--color-muted)] focus:border-[var(--color-highlight-soft)] focus:bg-[rgba(255,255,255,0.05)] disabled:cursor-not-allowed disabled:opacity-60',
            className,
        ].join(' ')}
        type={type}
        {...props}
    />
);