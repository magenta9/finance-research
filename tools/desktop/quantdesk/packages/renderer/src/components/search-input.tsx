import type { InputHTMLAttributes } from 'react';

import { Button } from './button';
import { Input } from './input';

interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
    onChange: (value: string) => void;
    onSubmit?: () => void;
    value: string;
}

export const SearchInput = ({
    className = '',
    onChange,
    onSubmit,
    placeholder = '搜索',
    value,
    ...props
}: SearchInputProps) => (
    <label
        className={[
            'flex h-11 min-h-11 shrink-0 w-full min-w-0 items-center gap-3 rounded-[18px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-strong)] px-4 text-sm shadow-[0_14px_30px_rgba(23,19,16,0.08)] transition-[border-color,background-color,box-shadow] focus-within:border-[var(--color-highlight-soft)]',
            className,
        ].join(' ')}
    >
        <span className="text-[var(--color-muted)]">
            <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24">
                <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <path d="M16 16 21 21" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
            </svg>
        </span>
        <Input
            className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-[var(--color-foreground)] outline-none placeholder:text-[var(--color-muted)]"
            onChange={(event) => {
                onChange(event.currentTarget.value);
            }}
            onKeyDown={(event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    onSubmit?.();
                }
            }}
            placeholder={placeholder}
            type="search"
            value={value}
            {...props}
        />
        {value && (
            <Button
                aria-label="清空搜索"
                className="shrink-0 border-0 bg-transparent px-3 text-xs text-[var(--color-muted)] shadow-none hover:bg-transparent hover:text-[var(--color-foreground)] whitespace-nowrap"
                onClick={() => {
                    onChange('');
                }}
                size="sm"
                tone="ghost"
                type="button"
            >
                清空
            </Button>
        )}
    </label>
);