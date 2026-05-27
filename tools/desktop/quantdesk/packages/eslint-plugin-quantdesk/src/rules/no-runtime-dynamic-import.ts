import type { Rule } from 'eslint';

import { runtimeDynamicImportAllowlist } from '../policy/dynamic-import-policy';
import { isPolicyAllowed } from '../policy/path-policy';

const message = 'Runtime import() is only allowed in toolchain config files declared in the QuantDesk policy. Use static imports or a typed facade instead.';

export const noRuntimeDynamicImportRule: Rule.RuleModule = {
    meta: {
        docs: {
            description: 'Disallow runtime dynamic import() outside the QuantDesk toolchain allowlist.',
        },
        schema: [],
        type: 'problem',
    },
    create(context) {
        const filename = context.getFilename();

        if (isPolicyAllowed(filename, runtimeDynamicImportAllowlist)) {
            return {};
        }

        return {
            ImportExpression(node) {
                context.report({
                    node,
                    message,
                });
            },
        };
    },
};