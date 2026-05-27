import type { InputHTMLAttributes, ReactNode } from 'react';

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
    children?: ReactNode;
    description?: ReactNode;
}

export const Checkbox = ({ children, className = '', description, ...props }: CheckboxProps) => {
    const control = (
        <input
            className={[
                'mt-0.5 h-4 w-4 rounded border-[color:var(--color-border)] accent-[var(--color-highlight)]',
                className,
            ].join(' ')}
            type="checkbox"
            {...props}
        />
    );

    if (!children && !description) {
        return control;
    }

    return (
        <label className="flex items-start gap-3 text-sm text-[var(--color-copy)]">
            {control}
            <span className="space-y-1">
                {children && <span className="block text-[var(--color-foreground)]">{children}</span>}
                {description && <span className="block text-xs text-[var(--color-muted)]">{description}</span>}
            </span>
        </label>
    );
};