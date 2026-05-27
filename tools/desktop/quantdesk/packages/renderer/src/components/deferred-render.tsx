import { useEffect, useRef, useState } from 'react';

export const DeferredRender = ({
    children,
    className = '',
    fallbackLabel = '图表即将渲染',
}: {
    children: React.ReactNode;
    className?: string;
    fallbackLabel?: string;
}) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        const node = containerRef.current;

        if (!node) {
            return;
        }

        if (typeof IntersectionObserver === 'undefined') {
            setIsVisible(true);
            return;
        }

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    setIsVisible(true);
                    observer.disconnect();
                }
            },
            {
                rootMargin: '160px',
            },
        );

        observer.observe(node);

        return () => {
            observer.disconnect();
        };
    }, []);

    return (
        <div ref={containerRef} className={className}>
            {isVisible ? (
                children
            ) : (
                <div className="flex h-full min-h-[240px] items-center justify-center rounded-[24px] border border-dashed border-[color:var(--color-border)] bg-[rgba(244,239,230,0.42)] px-6 text-sm text-[var(--color-muted)]">
                    {fallbackLabel}
                </div>
            )}
        </div>
    );
};