import { describe, expect, test } from 'vitest';

import { noRendererDevImportsRule } from './no-renderer-dev-imports';
import { lintWithRule } from '../test-utils';

describe('no-renderer-dev-imports rule', () => {
    test('reports renderer dev imports from stores', () => {
        const messages = lintWithRule({
            code: 'import { ensureBrowserApi } from "../dev/browser-api"; export const value = ensureBrowserApi;',
            filename: 'packages/renderer/src/stores/app-store.ts',
            rule: noRendererDevImportsRule,
            ruleName: 'quantdesk/no-renderer-dev-imports',
        });

        expect(messages).toHaveLength(1);
        expect(messages[0]?.message).toContain('window.api');
    });

    test('reports aliased renderer dev imports from components', () => {
        const messages = lintWithRule({
            code: 'export { ensureBrowserApi } from "@renderer/dev/browser-api";',
            filename: 'packages/renderer/src/components/app-shell.tsx',
            rule: noRendererDevImportsRule,
            ruleName: 'quantdesk/no-renderer-dev-imports',
        });

        expect(messages).toHaveLength(1);
    });

    test('allows dev imports inside renderer bootstrap files', () => {
        const messages = lintWithRule({
            code: 'import { ensureBrowserApi } from "./dev/browser-api";',
            filename: 'packages/renderer/src/main.tsx',
            rule: noRendererDevImportsRule,
            ruleName: 'quantdesk/no-renderer-dev-imports',
        });

        expect(messages).toHaveLength(0);
    });
});
