export const parseJson = <T>(value: string): T => JSON.parse(value) as T;

export const stringifyJson = (value: unknown): string => JSON.stringify(value);
