import type { ReactNode } from 'react';

import { Button } from './button';

interface TagProps {
    children: ReactNode;
    onRemove?: () => void;
}

export const Tag = ({ children, onRemove }: TagProps) => (
    <span className="inline-flex items-center gap-2 rounded-full border border-[color:var(--color-highlight-soft)] bg-[rgba(156,98,55,0.08)] px-3 py-1.5 text-xs text-[var(--color-highlight)]">
        <span>{children}</span>
        {onRemove && (
            <Button
                aria-label={`删除标签 ${String(children)}`}
                className="h-4 w-4 rounded-full border-[color:var(--color-highlight-soft)] px-0 text-[10px] leading-none shadow-none hover:bg-[rgba(156,98,55,0.16)]"
                onClick={onRemove}
                size="sm"
                tone="secondary"
                type="button"
            >
                ×
            </Button>
        )}
    </span>
);