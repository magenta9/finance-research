import React from 'react';

import { Button } from './button';
import { logger } from '../lib/logger';

interface ErrorBoundaryState {
    errorMessage: string | null;
}

export class ErrorBoundary extends React.Component<
    React.PropsWithChildren,
    ErrorBoundaryState
> {
    constructor(props: React.PropsWithChildren) {
        super(props);
        this.state = { errorMessage: null };
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return {
            errorMessage: error.message || '渲染过程中发生未知错误。',
        };
    }

    override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        logger.error('React error boundary caught an error', error, {
            componentStack: errorInfo.componentStack ?? undefined,
        });
    }

    override render() {
        if (!this.state.errorMessage) {
            return this.props.children;
        }

        return (
            <div className="flex min-h-screen items-center justify-center bg-[var(--color-background)] px-6 py-10 text-[var(--color-foreground)]">
                <div className="w-full max-w-2xl rounded-[32px] border border-[rgba(159,58,41,0.18)] bg-[rgba(255,248,246,0.92)] p-8 shadow-[0_30px_90px_rgba(61,43,31,0.08)]">
                    <p className="text-xs uppercase tracking-[0.32em] text-[#7d2c22]">
                        Renderer Error Boundary
                    </p>
                    <h1 className="mt-4 font-display text-4xl leading-tight text-[var(--color-foreground)]">
                        当前页面渲染失败
                    </h1>
                    <p className="mt-4 text-base leading-7 text-[var(--color-copy)]">
                        {this.state.errorMessage}
                    </p>
                    <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">
                        已阻止错误继续扩散到整个工作台。刷新页面后会重新初始化本地状态。
                    </p>

                    <div className="mt-6 flex flex-wrap gap-3">
                        <Button
                            onClick={() => {
                                window.location.reload();
                            }}
                            tone="primary"
                        >
                            刷新应用
                        </Button>
                        <Button
                            onClick={() => {
                                window.location.hash = '#/';
                                window.location.reload();
                            }}
                            tone="ghost"
                        >
                            返回仪表盘
                        </Button>
                    </div>
                </div>
            </div>
        );
    }
}