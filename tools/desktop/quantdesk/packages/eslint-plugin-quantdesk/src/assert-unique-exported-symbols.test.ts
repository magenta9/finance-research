import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { describe, expect, test } from 'vitest';

const scriptPath = path.resolve(__dirname, '../scripts/assert-unique-exported-symbols.mjs');
const fixturesRoot = path.resolve(__dirname, '../fixtures/unique-exports');

describe('assert-unique-exported-symbols script', () => {
    test('passes when exported symbol names are unique', () => {
        expect(() => {
            execFileSync('node', [scriptPath, path.join(fixturesRoot, 'good')], {
                encoding: 'utf8',
            });
        }).not.toThrow();
    });

    test('fails when exported symbol names collide across files', () => {
        expect(() => {
            execFileSync('node', [scriptPath, path.join(fixturesRoot, 'bad')], {
                encoding: 'utf8',
                stdio: 'pipe',
            });
        }).toThrow(/MetricCard/);
    });
});