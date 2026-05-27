import { describe, expect, test } from 'vitest';

import { noRawInteractiveElementsRule } from './no-raw-interactive-elements';
import { lintWithRule } from '../test-utils';

describe('no-raw-interactive-elements rule', () => {
    test('reports raw input controls in a renderer route', () => {
        const messages = lintWithRule({
            code: 'export const Page = () => <input type="text" />;',
            filename: 'packages/renderer/src/routes/example-page.tsx',
            rule: noRawInteractiveElementsRule,
            ruleName: 'quantdesk/no-raw-interactive-elements',
        });

        expect(messages).toHaveLength(1);
        expect(messages[0]?.message).toContain('Use the shared Input primitive');
    });

    test('reports checkbox inputs with Checkbox-specific guidance', () => {
        const messages = lintWithRule({
            code: 'export const Field = () => <input type="checkbox" />;',
            filename: 'packages/renderer/src/components/form-field.tsx',
            rule: noRawInteractiveElementsRule,
            ruleName: 'quantdesk/no-raw-interactive-elements',
        });

        expect(messages).toHaveLength(1);
        expect(messages[0]?.message).toContain('Checkbox');
    });

    test('allows primitives that are declared in policy', () => {
        const messages = lintWithRule({
            code: 'export const Input = () => <input type="text" />;',
            filename: 'packages/renderer/src/components/input.tsx',
            rule: noRawInteractiveElementsRule,
            ruleName: 'quantdesk/no-raw-interactive-elements',
        });

        expect(messages).toHaveLength(0);
    });
});