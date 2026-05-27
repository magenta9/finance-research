import type { Rule } from 'eslint';

import { isPolicyAllowed } from '../policy/path-policy';
import { directSqlAllowlist } from '../policy/sql-policy';

const restrictedCalls = new Set(['prepare', 'exec']);

const message = 'Direct SQL is only allowed in packages/main/src/db/**. Move this query behind a repository or DB helper.';

const isSqlLikeArgument = (argument: unknown) => {
    if (!argument || typeof argument !== 'object') {
        return false;
    }

    const candidate = argument as {
        expressions?: unknown[];
        quasis?: Array<{ value?: { cooked?: string | null } }>;
        type?: string;
        value?: unknown;
    };

    if (candidate.type === 'Literal') {
        return typeof candidate.value === 'string';
    }

    if (candidate.type !== 'TemplateLiteral') {
        return false;
    }

    if (candidate.expressions?.length) {
        return false;
    }

    return candidate.quasis?.some((quasi) => (quasi.value?.cooked ?? '').trim().length > 0) ?? false;
};

export const noDirectSqlOutsideReposRule: Rule.RuleModule = {
    meta: {
        docs: {
            description: 'Disallow direct SQLite prepare/exec calls outside the DB layer.',
        },
        schema: [],
        type: 'problem',
    },
    create(context) {
        const filename = context.getFilename();

        if (isPolicyAllowed(filename, directSqlAllowlist)) {
            return {};
        }

        return {
            CallExpression(node) {
                if (node.callee.type !== 'MemberExpression' || node.callee.computed) {
                    return;
                }

                if (node.callee.property.type !== 'Identifier') {
                    return;
                }

                if (!restrictedCalls.has(node.callee.property.name)) {
                    return;
                }

                if (!isSqlLikeArgument(node.arguments[0])) {
                    return;
                }

                context.report({
                    node,
                    message,
                });
            },
        };
    },
};