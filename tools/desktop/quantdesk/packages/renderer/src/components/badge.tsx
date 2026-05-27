import type { ReactNode } from 'react';

interface BadgeProps {
    children: ReactNode;
    className?: string;
    tone?: 'default' | 'accent' | 'muted' | 'danger';
}

const toneClassMap: Record<NonNullable<BadgeProps['tone']>, string> = {
    default: 'border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[var(--color-copy)]',
    accent: 'border-[color:var(--color-highlight-soft)] bg-[rgba(156,98,55,0.08)] text-[var(--color-highlight)]',
    danger: 'border-[rgba(255,108,87,0.24)] bg-[rgba(255,108,87,0.1)] text-[#ffb2a6]',
    muted: 'border-transparent bg-[rgba(70,53,43,0.06)] text-[var(--color-muted)]',
};

export const Badge = ({ children, className = '', tone = 'default' }: BadgeProps) => (
    <span
        className={[
            'inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]',
            toneClassMap[tone],
            className,
        ].join(' ')}
    >
        {children}
    </span>
);