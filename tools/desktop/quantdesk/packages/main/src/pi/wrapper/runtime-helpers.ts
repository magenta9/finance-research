import { asString, isRecord } from '@quantdesk/shared/type-guards';

import type { PiRuntimeDirectories, PiRuntimeStatus } from '../types';

export const extractText = (content: unknown): string => {
    if (typeof content === 'string') {
        return content;
    }

    if (!Array.isArray(content)) {
        return '';
    }

    return content.map((entry) => {
        if (!isRecord(entry)) {
            return '';
        }

        if (entry.type === 'text') {
            return asString(entry.text);
        }

        if (entry.type === 'toolCall') {
            return `[tool:${asString(entry.toolName) || asString(entry.name) || 'unknown'}]`;
        }

        if (entry.type === 'image') {
            return '[image]';
        }

        return '';
    }).filter(Boolean).join('\n');
};

export const toIsoString = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) {
        return value;
    }

    return new Date().toISOString();
};

export const createDefaultStatus = (
    directories: PiRuntimeDirectories,
    sessionCount: number,
    financeToolNames: string[],
    input: Partial<PiRuntimeStatus> = {},
): PiRuntimeStatus => ({
    currentSessionId: input.currentSessionId ?? null,
    degraded: input.degraded ?? false,
    degradedReason: input.degradedReason ?? null,
    diagnostics: input.diagnostics ?? [],
    directories,
    financeTools: {
        available: financeToolNames.length > 0,
        lastError: input.financeTools?.lastError ?? null,
        names: financeToolNames,
    },
    lastCheckedAt: input.lastCheckedAt ?? null,
    lastError: input.lastError ?? null,
    lastStartedAt: input.lastStartedAt ?? null,
    model: input.model ?? {
        available: false,
        availableModels: [],
        model: null,
        provider: null,
        source: 'unknown',
    },
    pid: input.pid ?? process.pid,
    sessionCount,
    state: input.state ?? 'stopped',
    wrapperVersion: input.wrapperVersion ?? null,
});

type PiTypeNamespace = Record<string, (...args: unknown[]) => unknown>;
type PiStringEnum = (values: string[], options?: Record<string, unknown>) => unknown;

export const convertSchemaToPiType = (
    schema: Record<string, unknown>,
    Type: PiTypeNamespace,
    stringEnum?: PiStringEnum,
): unknown => {
    const type = asString(schema.type);

    if (type === 'object') {
        const properties = isRecord(schema.properties) ? schema.properties : {};
        const required = new Set(
            Array.isArray(schema.required)
                ? schema.required.filter((entry): entry is string => typeof entry === 'string')
                : [],
        );
        const converted = Object.fromEntries(Object.entries(properties).map(([key, value]) => {
            const convertedValue = convertSchemaToPiType(
                isRecord(value) ? value : {},
                Type,
                stringEnum,
            );
            return [key, required.has(key) ? convertedValue : Type.Optional(convertedValue)];
        }));

        return Type.Object(converted, {
            additionalProperties: Boolean(schema.additionalProperties),
        });
    }

    if (type === 'array') {
        return Type.Array(
            convertSchemaToPiType(isRecord(schema.items) ? schema.items : {}, Type, stringEnum),
        );
    }

    if (type === 'number') {
        return Type.Number({
            default: schema.default,
            description: asString(schema.description) || undefined,
            maximum: typeof schema.maximum === 'number' ? schema.maximum : undefined,
            minimum: typeof schema.minimum === 'number' ? schema.minimum : undefined,
        });
    }

    if (type === 'integer') {
        return Type.Integer({
            default: schema.default,
            description: asString(schema.description) || undefined,
            maximum: typeof schema.maximum === 'number' ? schema.maximum : undefined,
            minimum: typeof schema.minimum === 'number' ? schema.minimum : undefined,
        });
    }

    if (type === 'string') {
        const options = {
            default: schema.default,
            description: asString(schema.description) || undefined,
            maxLength: typeof schema.maxLength === 'number' ? schema.maxLength : undefined,
            minLength: typeof schema.minLength === 'number' ? schema.minLength : undefined,
        };

        if (Array.isArray(schema.enum) && schema.enum.every((entry) => typeof entry === 'string') && stringEnum) {
            return stringEnum(schema.enum, options);
        }

        return Type.String(options);
    }

    if (type === 'boolean') {
        return Type.Boolean({
            default: schema.default,
            description: asString(schema.description) || undefined,
        });
    }

    return Type.Any();
};
