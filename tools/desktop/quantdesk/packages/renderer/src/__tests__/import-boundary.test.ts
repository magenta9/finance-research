import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const devDir = path.join(rootDir, 'dev');
const allowedDevFiles = new Set([
    'browser-api.ts',
    'ws-bridge-client.test.ts',
    'ws-bridge-client.ts',
]);

const collectFiles = async (dirPath: string): Promise<string[]> => {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async (entry) => {
        const entryPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
            return await collectFiles(entryPath);
        }

        if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
            return [entryPath];
        }

        return [];
    }));

    return nested.flat();
};

describe('renderer import boundary', () => {
    test('dev/ only contains bootstrap or transport helpers', async () => {
        const files = await collectFiles(devDir);
        const unexpectedFiles = files
            .map((filePath) => path.relative(devDir, filePath))
            .filter((relativePath) => {
                if (relativePath.startsWith('fixtures/')) {
                    return false;
                }

                return !allowedDevFiles.has(relativePath);
            });

        expect(unexpectedFiles).toEqual([]);
    });
});