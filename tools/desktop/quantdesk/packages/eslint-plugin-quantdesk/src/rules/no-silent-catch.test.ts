import { describe, expect, test } from 'vitest';

import { noSilentCatchRule } from './no-silent-catch';
import { lintWithRule } from '../test-utils';

describe('no-silent-catch rule', () => {
    test('reports bare catch clauses', () => {
        const messages = lintWithRule({
            code: 'try { work(); } catch { cleanup(); }',
            filename: 'packages/preload/src/api.ts',
            rule: noSilentCatchRule,
            ruleName: 'quantdesk/no-silent-catch',
        });

        expect(messages).toHaveLength(1);
        expect(messages[0]?.message).toContain('declare an error parameter');
    });

    test('reports silent Promise.catch handlers', () => {
        const messages = lintWithRule({
            code: 'void task().catch(() => undefined);',
            filename: 'packages/renderer/src/dev/browser-api.ts',
            rule: noSilentCatchRule,
            ruleName: 'quantdesk/no-silent-catch',
        });

        expect(messages).toHaveLength(1);
        expect(messages[0]?.message).toContain('Promise.catch handlers must declare an error parameter');
    });

    test('allows explicit suppression helpers that consume the error', () => {
        const messages = lintWithRule({
            code: [
                'const suppressKnownError = (error: unknown, context: string) => ({ error, context });',
                'try { work(); } catch (error) { suppressKnownError(error, "cleanup"); }',
                'void task().catch((error) => suppressKnownError(error, "background"));',
            ].join('\n'),
            filename: 'packages/main/src/example.ts',
            rule: noSilentCatchRule,
            ruleName: 'quantdesk/no-silent-catch',
        });

        expect(messages).toHaveLength(0);
    });
});