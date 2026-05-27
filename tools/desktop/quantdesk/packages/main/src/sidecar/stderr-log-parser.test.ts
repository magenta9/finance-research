import { describe, expect, test, vi } from 'vitest';

import type { LoggerLike } from '../logger';
import {
    normalizeLogLevel,
    parseStderrLines,
} from './stderr-log-parser';

const createLoggerStub = () => ({
    close: vi.fn().mockResolvedValue(undefined),
    error: vi.fn(),
    fatal: vi.fn(),
    getLogDirectory: vi.fn().mockReturnValue(null),
    info: vi.fn(),
    warn: vi.fn(),
    write: vi.fn(),
}) satisfies LoggerLike;

describe('stderr log parser', () => {
    test('parses structured sidecar log lines and tracks the last error', () => {
        const logger = createLoggerStub();
        const result = parseStderrLines([
            '{"level":"error","message":"rpc_error","detail":"boom","traceback":["line 1\\n","line 2\\n"]}',
            'plain-text-warning',
        ], logger);

        expect(logger.write).toHaveBeenCalledWith(expect.objectContaining({
            error: 'boom',
            level: 'error',
            message: 'rpc_error',
            source: 'sidecar',
            stack: 'line 1\nline 2\n',
        }));
        expect(logger.warn).toHaveBeenCalledWith(
            'sidecar',
            'plain-text-warning',
        );
        expect(result).toEqual({ 
            lastDiagnostic: expect.objectContaining({
                level: 'warn',
                message: 'plain-text-warning',
                raw: 'plain-text-warning',
                source: 'stderr',
            }),
            lastError: 'plain-text-warning',
        });
    });

    test('normalizes unknown levels to info', () => {
        const logger = createLoggerStub();

        parseStderrLines([
            '{"level":"mystery","message":"hello"}',
        ], logger);

        expect(normalizeLogLevel('mystery')).toBe('info');
        expect(logger.write).toHaveBeenCalledWith(expect.objectContaining({
            level: 'info',
            message: 'hello',
        }));
    });

    test('reports malformed JSON parse errors only for JSON-shaped stderr lines', () => {
        const logger = createLoggerStub();

        parseStderrLines([
            '{broken-json',
        ], logger);

        expect(logger.warn).toHaveBeenCalledWith(
            'sidecar',
            'Malformed sidecar stderr JSON.',
            expect.objectContaining({
                error: expect.any(String),
                rawLine: '{broken-json',
            }),
        );
    });
});