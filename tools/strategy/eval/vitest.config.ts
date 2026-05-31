import path from 'node:path';

import { defineConfig } from 'vitest/config';

const quantdeskSharedRoot = path.resolve(__dirname, '../../desktop/quantdesk/packages/shared/src');
const allocationEngineRoot = path.resolve(__dirname, '../allocation-engine/src');

export default defineConfig({
    resolve: {
        alias: [
            {
                find: /^@finance-research\/allocation-engine\/(.+)$/,
                replacement: `${allocationEngineRoot}/$1.ts`,
            },
            {
                find: '@finance-research/allocation-engine',
                replacement: path.resolve(allocationEngineRoot, 'index.ts'),
            },
            {
                find: /^@quantdesk\/shared\/(.+)$/,
                replacement: `${quantdeskSharedRoot}/$1.ts`,
            },
            {
                find: '@quantdesk/shared',
                replacement: path.resolve(quantdeskSharedRoot, 'index.ts'),
            },
        ],
    },
    test: {
        environment: 'node',
        globals: true,
        include: ['*.test.ts'],
    },
});
