import path from 'node:path';

import { defineConfig } from 'vitest/config';

const quantdeskSharedRoot = path.resolve(__dirname, '../../desktop/quantdesk/packages/shared/src');
const quantdeskMainNodeModules = path.resolve(__dirname, '../../desktop/quantdesk/packages/main/node_modules');

export default defineConfig({
    resolve: {
        alias: [
            {
                find: /^@quantdesk\/shared\/(.+)$/,
                replacement: `${quantdeskSharedRoot}/$1.ts`,
            },
            {
                find: '@quantdesk/shared',
                replacement: path.resolve(quantdeskSharedRoot, 'index.ts'),
            },
            {
                find: 'ml-matrix',
                replacement: path.resolve(quantdeskMainNodeModules, 'ml-matrix/matrix.js'),
            },
        ],
    },
    test: {
        environment: 'node',
        globals: true,
        include: ['src/**/*.test.ts'],
    },
});
