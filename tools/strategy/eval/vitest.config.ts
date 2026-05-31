import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        alias: [
            {
                find: /^@quantdesk\/shared\/(.+)$/,
                replacement: `${path.resolve(__dirname, '../../desktop/quantdesk/packages/shared/src')}/$1.ts`,
            },
            {
                find: '@quantdesk/shared',
                replacement: path.resolve(__dirname, '../../desktop/quantdesk/packages/shared/src/index.ts'),
            },
        ],
    },
    test: {
        environment: 'node',
        globals: true,
        include: ['*.test.ts'],
    },
});
