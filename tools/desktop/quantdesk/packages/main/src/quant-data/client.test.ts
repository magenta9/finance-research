import { describe, expect, test, vi } from 'vitest';

import { QuantDataCliClient, QuantDataCliError, type QuantDataProcessRequest } from './client';

describe('QuantDataCliClient', () => {
    test('runs a JSON envelope command with newline-delimited input', async () => {
        const calls: QuantDataProcessRequest[] = [];
        const runner = vi.fn(async (request: QuantDataProcessRequest) => {
            calls.push(request);
            return {
                exitCode: 0,
                signal: null,
                stderr: '',
                stdout: JSON.stringify({ ok: true, data: [{ symbol: '510300' }] }),
            };
        });
        const client = new QuantDataCliClient({ args: ['run', './cmd/quant-data'], command: 'go', cwd: '/repo/tools/data/quant-data', runner, timeoutMs: 1000 });

        await expect(client.run('search-assets', { market: 'A', query: '510300' })).resolves.toMatchObject({
            data: [{ symbol: '510300' }],
            ok: true,
        });

        expect(calls).toEqual([{
            args: ['run', './cmd/quant-data', 'search-assets'],
            command: 'go',
            cwd: '/repo/tools/data/quant-data',
            env: undefined,
            input: '{"market":"A","query":"510300"}\n',
            timeoutMs: 1000,
        }]);
    });

    test('runs help with the JSON flag as a raw contract response', async () => {
        const runner = vi.fn(async () => ({
            exitCode: 0,
            signal: null,
            stderr: '',
            stdout: JSON.stringify({ contractVersion: 'quant-data-cli.v1' }),
        }));
        const client = new QuantDataCliClient({ command: 'quant-data', runner });

        await expect(client.helpJson<{ contractVersion: string }>()).resolves.toEqual({ contractVersion: 'quant-data-cli.v1' });

        expect(runner).toHaveBeenCalledWith(expect.objectContaining({
            args: ['help', '--json'],
            input: undefined,
        }));
    });

    test('rejects nonzero process exits', async () => {
        const client = new QuantDataCliClient({
            runner: async () => ({
                exitCode: 2,
                signal: null,
                stderr: 'boom',
                stdout: '',
            }),
        });

        await expect(client.run('status')).rejects.toMatchObject({
            code: 'process_failed',
            name: 'QuantDataCliError',
        });
    });

    test('rejects ok=false envelopes', async () => {
        const client = new QuantDataCliClient({
            runner: async () => ({
                exitCode: 0,
                signal: null,
                stderr: '',
                stdout: JSON.stringify({ ok: false, maintenanceError: { code: 'CONFIG_REQUIRED', message: 'config missing' } }),
            }),
        });

        await expect(client.run('status')).rejects.toMatchObject({
            code: 'command_failed',
            message: 'config missing',
        });
    });

    test('rejects invalid JSON envelopes', async () => {
        const client = new QuantDataCliClient({
            runner: async () => ({
                exitCode: 0,
                signal: null,
                stderr: '',
                stdout: 'not json',
            }),
        });

        const result = client.run('status');
        await expect(result).rejects.toBeInstanceOf(QuantDataCliError);
        await expect(result).rejects.toMatchObject({ code: 'invalid_json' });
    });
});
