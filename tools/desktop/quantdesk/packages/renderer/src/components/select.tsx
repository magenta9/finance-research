import type { SelectHTMLAttributes } from 'react';

type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export const Select = ({ children, className = '', ...props }: SelectProps) => (
    <select
        className={[
            'h-11 w-full rounded-[18px] border border-[color:var(--color-border)] bg-white/80 px-4 text-sm text-[var(--color-foreground)] shadow-[0_14px_30px_rgba(61,43,31,0.04)] outline-none transition focus:border-[var(--color-highlight-soft)] focus:bg-white disabled:cursor-not-allowed disabled:opacity-60',
            className,
        ].join(' ')}
        {...props}
    >
        {children}
    </select>
);