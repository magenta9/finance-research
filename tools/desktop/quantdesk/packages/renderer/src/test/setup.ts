import '@testing-library/jest-dom/vitest';

const createStorage = (): Storage => {
    const values = new Map<string, string>();

    return {
        get length() {
            return values.size;
        },
        clear() {
            values.clear();
        },
        getItem(key: string) {
            return values.get(key) ?? null;
        },
        key(index: number) {
            return [...values.keys()][index] ?? null;
        },
        removeItem(key: string) {
            values.delete(key);
        },
        setItem(key: string, value: string) {
            values.set(key, String(value));
        },
    };
};

if (typeof window !== 'undefined' && !window.localStorage) {
    Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: createStorage(),
    });
}

if (typeof window !== 'undefined' && !window.sessionStorage) {
    Object.defineProperty(window, 'sessionStorage', {
        configurable: true,
        value: createStorage(),
    });
}
