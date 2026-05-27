import { useCallback, useEffect, useRef, useState } from 'react';

export const useConversationAutoscroll = <T extends HTMLElement>({
    dependencyKey,
    threshold = 100,
}: {
    dependencyKey: number | string;
    threshold?: number;
}) => {
    const containerRef = useRef<T | null>(null);
    const [isPaused, setIsPaused] = useState(false);
    const [hasNewContent, setHasNewContent] = useState(false);

    const scrollToBottom = useCallback(() => {
        const node = containerRef.current;

        if (!node) {
            return;
        }

        node.scrollTo({
            behavior: 'smooth',
            top: node.scrollHeight,
        });
        setHasNewContent(false);
        setIsPaused(false);
    }, []);

    useEffect(() => {
        const node = containerRef.current;

        if (!node) {
            return undefined;
        }

        const handleScroll = () => {
            const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
            const nextPaused = distanceFromBottom > threshold;
            setIsPaused(nextPaused);

            if (!nextPaused) {
                setHasNewContent(false);
            }
        };

        handleScroll();
        node.addEventListener('scroll', handleScroll, { passive: true });

        return () => {
            node.removeEventListener('scroll', handleScroll);
        };
    }, [threshold]);

    useEffect(() => {
        const node = containerRef.current;

        if (!node) {
            return undefined;
        }

        const frameId = window.requestAnimationFrame(() => {
            const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;

            if (isPaused || distanceFromBottom > threshold) {
                setHasNewContent(true);
                return;
            }

            node.scrollTop = node.scrollHeight;
            setHasNewContent(false);
        });

        return () => {
            window.cancelAnimationFrame(frameId);
        };
    }, [dependencyKey, isPaused, threshold]);

    return {
        containerRef,
        hasNewContent,
        isPaused,
        jumpToLatest: scrollToBottom,
    };
};