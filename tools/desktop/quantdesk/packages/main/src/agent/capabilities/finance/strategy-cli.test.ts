import path from 'node:path';

import { describe, expect, test, vi } from 'vitest';

import { createFuturesTrendObservationService, normalizeFuturesTrendSymbol } from './strategy-cli';

describe('createFuturesTrendObservationService', () => {
  test('normalizes plain futures symbols to main continuous symbols', () => {
    expect(normalizeFuturesTrendSymbol('lh')).toBe('LH9999');
    expect(normalizeFuturesTrendSymbol('LH9999')).toBe('LH9999');
  });

  test('runs the repository strategy CLI and parses JSON output', async () => {
    const runner = vi.fn(async () => ({
      exitCode: 0,
      signal: null,
      stderr: '',
      stdout: JSON.stringify({
        latestDate: '2026-05-27',
        overallStatusLabel: '到达趋势观察位',
        symbol: 'LH9999',
      }),
    }));
    const service = createFuturesTrendObservationService({
      projectRoot: '/repo',
      pythonCommand: '/python',
      quantDataArgs: ['run', './cmd/quant-data'],
      quantDataCommand: 'go',
      quantDataCwd: '/repo/tools/data/quant-data',
      runner,
    });

    await expect(service.analyzeFuturesTrendObservation({
      end: '2026-05-27',
      lookbackDays: 3650,
      market: 'COMMODITY',
      symbol: 'lh',
    })).resolves.toMatchObject({
      overallStatusLabel: '到达趋势观察位',
      symbol: 'LH9999',
    });
    expect(runner).toHaveBeenCalledWith(expect.objectContaining({
      args: [
        path.join('/repo', 'tools', 'strategy', 'futures-trend-observation', 'analyze.py'),
        '--symbol',
        'LH9999',
        '--market',
        'COMMODITY',
        '--end',
        '2026-05-27',
        '--lookback-days',
        '3650',
        '--quant-data',
        'go',
        '--quant-data-arg',
        'run',
        '--quant-data-arg',
        './cmd/quant-data',
        '--quant-data-cwd',
        '/repo/tools/data/quant-data',
      ],
      command: '/python',
      cwd: '/repo',
    }));
  });

  test('fails closed when the strategy CLI exits non-zero', async () => {
    const service = createFuturesTrendObservationService({
      projectRoot: '/repo',
      pythonCommand: '/python',
      runner: async () => ({
        exitCode: 2,
        signal: null,
        stderr: 'boom',
        stdout: '',
      }),
    });

    await expect(service.analyzeFuturesTrendObservation({
      market: 'COMMODITY',
      symbol: 'LH9999',
    })).rejects.toThrow('strategy CLI exited with 2: boom');
  });
});