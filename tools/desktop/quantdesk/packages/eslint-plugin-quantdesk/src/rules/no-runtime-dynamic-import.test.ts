import { describe, expect, test } from 'vitest';

import { noRuntimeDynamicImportRule } from './no-runtime-dynamic-import';
import { lintWithRule } from '../test-utils';

describe('no-runtime-dynamic-import rule', () => {
    test('reports runtime import expressions in product source', () => {
        const messages = lintWithRule({
            code: 'export const load = async () => await import("./lazy");',
            filename: 'packages/main/src/runtime-loader.ts',
            rule: noRuntimeDynamicImportRule,
            ruleName: 'quantdesk/no-runtime-dynamic-import',
        });

        expect(messages).toHaveLength(1);
        expect(messages[0]?.message).toContain('Runtime import() is only allowed');
    });

    test('allows dynamic import in approved toolchain config files', () => {
        const messages = lintWithRule({
            code: 'export default async () => await import("@vitejs/plugin-react");',
            filename: 'packages/renderer/vite.config.ts',
            rule: noRuntimeDynamicImportRule,
            ruleName: 'quantdesk/no-runtime-dynamic-import',
        });

        expect(messages).toHaveLength(0);
    });

    test('does not flag type-only import expressions', () => {
        const messages = lintWithRule({
            code: 'export type Asset = import("@quantdesk/shared").StoredAsset;',
            filename: 'packages/main/src/types.ts',
            rule: noRuntimeDynamicImportRule,
            ruleName: 'quantdesk/no-runtime-dynamic-import',
        });

        expect(messages).toHaveLength(0);
    });
});