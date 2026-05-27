import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

import { Logger } from './logger';

describe('Logger', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    test('writes JSON lines and safely serializes complex context', async () => {
        const logDir = await fs.mkdtemp(path.join(os.tmpdir(), 'quantdesk-logger-'));
        const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        const logger = new Logger({ logDir, minLevel: 'debug' });
        const circular: Record<string, unknown> = { amount: BigInt(42) };
        circular.self = circular;

        logger.error('main', 'structured error', new Error('boom'), {
            circular,
            nested: { deeper: { value: 'kept' } },
        });
        await logger.close();

        const contents = await fs.readFile(path.join(logDir, 'quantdesk.log'), 'utf8');
        const [firstLine] = contents.trim().split('\n');
        const payload = JSON.parse(firstLine) as {
            context: {
                circular: {
                    amount: string;
                    self: string;
                };
            };
            error: string;
            level: string;
            message: string;
            pid: number;
            source: string;
            stack?: string;
            ts: string;
        };

        expect(payload.level).toBe('error');
        expect(payload.message).toBe('structured error');
        expect(payload.error).toBe('boom');
        expect(payload.source).toBe('main');
        expect(payload.pid).toBe(process.pid);
        expect(new Date(payload.ts).toISOString()).toBe(payload.ts);
        expect(payload.context.circular.amount).toBe('42');
        expect(payload.context.circular.self).toBe('[Circular]');
        expect(payload.stack).toContain('Error: boom');
        expect(stderrSpy).toHaveBeenCalled();
    });

    test('filters messages below minLevel', async () => {
        const logDir = await fs.mkdtemp(path.join(os.tmpdir(), 'quantdesk-logger-'));
        const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        const logger = new Logger({ logDir, minLevel: 'error' });

        logger.info('main', 'ignored');
        logger.warn('main', 'also ignored');
        logger.error('main', 'kept');
        await logger.close();

        const contents = await fs.readFile(path.join(logDir, 'quantdesk.log'), 'utf8');
        const lines = contents.trim().split('\n');

        expect(lines).toHaveLength(1);
        expect(JSON.parse(lines[0])).toMatchObject({ message: 'kept' });
        expect(stderrSpy).toHaveBeenCalledTimes(1);
    });

    test('rotates files when size limit is exceeded', async () => {
        const logDir = await fs.mkdtemp(path.join(os.tmpdir(), 'quantdesk-logger-'));
        vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        const logger = new Logger({
            logDir,
            maxFileSize: 120,
            maxFiles: 3,
            minLevel: 'debug',
        });

        logger.info('main', 'first entry that is long enough to force a rotation soon');
        logger.info('main', 'second entry that should land in a fresh log file');
        await logger.close();

        const currentLog = await fs.readFile(path.join(logDir, 'quantdesk.log'), 'utf8');
        const rotatedLog = await fs.readFile(path.join(logDir, 'quantdesk.1.log'), 'utf8');

        expect(currentLog).toContain('second entry');
        expect(rotatedLog).toContain('first entry');
    });

    test('disables stderr mirroring after a broken pipe and keeps file logging alive', async () => {
        const logDir = await fs.mkdtemp(path.join(os.tmpdir(), 'quantdesk-logger-'));
        const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((
            _chunk: string | Uint8Array,
            encoding?: BufferEncoding | ((error: Error | null | undefined) => void),
            callback?: (error: Error | null | undefined) => void,
        ) => {
            const resolvedCallback = typeof encoding === 'function' ? encoding : callback;
            resolvedCallback?.(new Error('write EPIPE'));
            return false;
        }) as typeof process.stderr.write);
        const logger = new Logger({ logDir, minLevel: 'debug' });

        logger.warn('main', 'first stderr write fails');
        logger.warn('main', 'second line still reaches the log file');
        await logger.close();

        const contents = await fs.readFile(path.join(logDir, 'quantdesk.log'), 'utf8');
        const lines = contents.trim().split('\n').map((line) => JSON.parse(line) as { message: string });

        expect(stderrSpy).toHaveBeenCalledTimes(1);
        expect(lines.map((line) => line.message)).toEqual([
            'first stderr write fails',
            'second line still reaches the log file',
        ]);
    });
});