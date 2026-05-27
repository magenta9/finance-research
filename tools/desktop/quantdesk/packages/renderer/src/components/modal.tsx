import type { ReactNode } from 'react';

import { Button } from './button';

interface ModalProps {
    actions?: ReactNode;
    children: ReactNode;
    description?: string;
    eyebrow?: string;
    onClose: () => void;
    open: boolean;
    title: string;
}

export const Modal = ({
    actions,
    children,
    description,
    eyebrow = '批量导入',
    onClose,
    open,
    title,
}: ModalProps) => {
    if (!open) {
        return null;
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(23,19,16,0.36)] px-4 py-8 backdrop-blur-sm">
            <div className="w-full max-w-4xl rounded-[30px] border border-[color:var(--color-border)] bg-[var(--color-surface-strong)] p-6 shadow-[0_35px_100px_rgba(23,19,16,0.22)]">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <p className="text-xs uppercase tracking-[0.28em] text-[var(--color-muted)]">
                            {eyebrow}
                        </p>
                        <h2 className="mt-2 font-display text-3xl text-[var(--color-foreground)]">
                            {title}
                        </h2>
                        {description && (
                            <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--color-copy)]">
                                {description}
                            </p>
                        )}
                    </div>
                    <Button
                        aria-label="关闭弹窗"
                        className="h-10 w-10 rounded-full px-0 text-lg text-[var(--color-copy)] hover:text-[var(--color-foreground)]"
                        onClick={onClose}
                        size="sm"
                        tone="ghost"
                        type="button"
                    >
                        ×
                    </Button>
                </div>
                <div className="mt-6">{children}</div>
                {actions && <div className="mt-6 flex justify-end gap-3">{actions}</div>}
            </div>
        </div>
    );
};