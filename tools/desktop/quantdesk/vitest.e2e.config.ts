import { defineConfig } from 'vitest/config';

process.env.QUANTDESK_VITEST_NATIVE_TARGET = 'electron';

export default defineConfig({
    test: {
        globals: true,
        globalSetup: ['./vitest.native.global-setup.ts'],
        include: ['packages/main/e2e/*.e2e.test.ts'],
        fileParallelism: false,
        maxWorkers: 1,
    },
});