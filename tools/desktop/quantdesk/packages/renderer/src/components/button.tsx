import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    children: ReactNode;
    tone?: 'primary' | 'secondary' | 'ghost' | 'danger';
    size?: 'sm' | 'md' | 'none';
}

const toneClassMap: Record<NonNullable<ButtonProps['tone']>, string> = {
    primary: 'border-[var(--color-highlight)] bg-[var(--color-highlight)] text-white shadow-[0_12px_24px_rgba(156,98,55,0.18)] hover:bg-[#87542f] hover:border-[#87542f]',
    secondary: 'border-[color:var(--color-highlight-soft)] bg-[rgba(156,98,55,0.08)] text-[var(--color-foreground)] hover:bg-[rgba(156,98,55,0.14)]',
    ghost: 'border-[color:var(--color-border)] bg-transparent text-[var(--color-copy)] hover:border-[var(--color-highlight-soft)] hover:text-[var(--color-foreground)]',
    danger: 'border-[rgba(255,108,87,0.24)] bg-[rgba(255,108,87,0.1)] text-[#ffb2a6] hover:bg-[rgba(255,108,87,0.16)]',
};

const sizeClassMap: Record<NonNullable<ButtonProps['size']>, string> = {
    sm: 'h-9 px-3 text-sm',
    md: 'h-11 px-4 text-sm',
    none: '',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({
    children,
    className = '',
    disabled,
    size = 'md',
    tone = 'secondary',
    type = 'button',
    ...props
}, ref) => (
    <button
        className={[
            'inline-flex items-center justify-center gap-2 rounded-[14px] border font-medium transition duration-200 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(197,138,77,0.32)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent disabled:active:scale-100',
            toneClassMap[tone],
            sizeClassMap[size],
            disabled ? 'cursor-not-allowed opacity-55' : '',
            className,
        ].join(' ')}
        disabled={disabled}
        ref={ref}
        type={type}
        {...props}
    >
        {children}
    </button>
));

Button.displayName = 'Button';