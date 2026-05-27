import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const { default: react } = await import('@vitejs/plugin-react');
  const sharedSourceRoot = path.resolve(__dirname, 'packages/shared/src');
  process.env.QUANTDESK_VITEST_NATIVE_TARGET = 'node';

  return {
    plugins: [react()],
    resolve: {
      alias: [
        { find: /^@quantdesk\/shared\/(.+)$/, replacement: `${sharedSourceRoot}/$1.ts` },
        { find: '@quantdesk/shared', replacement: `${sharedSourceRoot}/index.ts` },
        { find: '@renderer', replacement: path.resolve(__dirname, 'packages/renderer/src') },
        { find: '@shared', replacement: sharedSourceRoot },
      ],
    },
    test: {
      globals: true,
      globalSetup: ['./vitest.native.global-setup.ts'],
      include: ['packages/*/src/**/*.test.{ts,tsx}'],
      exclude: [
        'packages/**/node_modules/**',
        'packages/main/src/e2e/**/*.e2e.test.{ts,tsx}',
        'packages/main/e2e/**/*.e2e.test.{ts,tsx}',
      ],
      environmentOptions: {
        jsdom: {
          url: 'http://localhost/',
        },
      },
      setupFiles: ['./packages/renderer/src/test/setup.ts'],
    },
  };
});
