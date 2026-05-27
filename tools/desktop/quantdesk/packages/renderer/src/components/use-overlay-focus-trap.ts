import { useEffect, useRef } from 'react';

const focusableSelector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(', ');

const getFocusableElements = (container: HTMLElement) => (
    Array.from(container.querySelectorAll<HTMLElement>(focusableSelector)).filter((element) => {
        if (element.getAttribute('aria-hidden') === 'true') {
            return false;
        }

        return !element.hasAttribute('disabled');
    })
);

export const useOverlayFocusTrap = <T extends HTMLElement>(open: boolean, onClose?: () => void) => {
    const containerRef = useRef<T | null>(null);

    useEffect(() => {
        if (!open) {
            return undefined;
        }

        const container = containerRef.current;

        if (!container) {
            return undefined;
        }

        const previousActiveElement = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;

        const focusFirstElement = () => {
            const focusableElements = getFocusableElements(container);
            (focusableElements[0] ?? container).focus();
        };

        const frameId = window.requestAnimationFrame(focusFirstElement);

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose?.();
                return;
            }

            if (event.key !== 'Tab') {
                return;
            }

            const focusableElements = getFocusableElements(container);

            if (focusableElements.length === 0) {
                event.preventDefault();
                container.focus();
                return;
            }

            const firstElement = focusableElements[0];
            const lastElement = focusableElements[focusableElements.length - 1];
            const activeElement = document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
            const activeIndex = activeElement ? focusableElements.indexOf(activeElement) : -1;

            if (activeIndex === -1) {
                event.preventDefault();
                (event.shiftKey ? lastElement : firstElement).focus();
                return;
            }

            if (event.shiftKey && activeElement === firstElement) {
                event.preventDefault();
                lastElement.focus();
                return;
            }

            if (!event.shiftKey && activeElement === lastElement) {
                event.preventDefault();
                firstElement.focus();
            }
        };

        window.addEventListener('keydown', handleKeyDown);

        return () => {
            window.cancelAnimationFrame(frameId);
            window.removeEventListener('keydown', handleKeyDown);
            previousActiveElement?.focus();
        };
    }, [open, onClose]);

    return containerRef;
};