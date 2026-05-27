import { useEffect, useMemo, useState } from 'react';

const storagePrefix = 'agent-content-block';

const readStoredState = (key: string) => {
    if (typeof window === 'undefined') {
        return null;
    }

    const value = window.localStorage.getItem(key);

    if (value !== 'true' && value !== 'false') {
        return null;
    }

    return value === 'true';
};

export const buildContentBlockCollapseStorageKey = (threadId: string, blockId: string) => (
    `${storagePrefix}:${threadId}:${blockId}`
);

export const useContentBlockCollapseState = ({
    blockId,
    defaultOpen,
    threadId,
}: {
    blockId: string;
    defaultOpen: boolean;
    threadId: string;
}) => {
    const storageKey = useMemo(() => buildContentBlockCollapseStorageKey(threadId, blockId), [blockId, threadId]);
    const [hasStoredPreference, setHasStoredPreference] = useState(() => readStoredState(storageKey) !== null);
    const [isOpen, setIsOpen] = useState(() => readStoredState(storageKey) ?? defaultOpen);

    useEffect(() => {
        const storedValue = readStoredState(storageKey);

        if (storedValue === null) {
            setHasStoredPreference(false);
            setIsOpen(defaultOpen);
            return;
        }

        setHasStoredPreference(true);
        setIsOpen(storedValue);
    }, [defaultOpen, storageKey]);

    const persistValue = (nextValue: boolean) => {
        if (typeof window !== 'undefined') {
            window.localStorage.setItem(storageKey, String(nextValue));
        }

        setHasStoredPreference(true);
        setIsOpen(nextValue);
    };

    return {
        hasStoredPreference,
        isOpen,
        setIsOpen: persistValue,
        toggle: () => {
            persistValue(!isOpen);
        },
    };
};