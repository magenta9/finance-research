export const isRecord = (value: unknown): value is Record<string, unknown> => (
    value != null && typeof value === 'object' && !Array.isArray(value)
);

export const asString = (value: unknown): string => (typeof value === 'string' ? value : '');
