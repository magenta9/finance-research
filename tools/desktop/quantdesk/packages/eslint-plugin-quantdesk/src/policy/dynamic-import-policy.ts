import type { PolicyPathEntry } from './path-policy';

export const runtimeDynamicImportAllowlist: PolicyPathEntry[] = [
    {
        path: 'vitest.config.ts',
        reason: 'Vitest config lazily loads the React plugin during config evaluation.',
    },
    {
        path: 'packages/renderer/vite.config.ts',
        reason: 'Vite config lazily loads toolchain plugins during startup.',
    },
];