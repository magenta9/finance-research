import path from 'node:path';

import { defineConfig } from 'vite';

export default defineConfig(async () => {
  const [{ default: react }, { default: tailwindcss }] = await Promise.all([
    import('@vitejs/plugin-react'),
    import('@tailwindcss/vite'),
  ]);

  const rendererPort = Number.parseInt(process.env.QUANTDESK_RENDERER_PORT ?? '5173', 10);

  return {
    base: './',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@renderer': path.resolve(__dirname, 'src'),
        '@shared': path.resolve(__dirname, '../shared/src'),
      },
    },
    server: {
      host: '127.0.0.1',
      port: Number.isInteger(rendererPort) && rendererPort > 0 ? rendererPort : 5173,
      strictPort: true,
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
  };
});
