import type { Rule } from 'eslint';

type DeclaredVariableNode = Parameters<Rule.RuleContext['getDeclaredVariables']>[0];

const isCatchCallback = (node: unknown) => {
    if (!node || typeof node !== 'object') {
        return false;
    }

    const candidate = node as {
        callee?: {
            computed?: unknown;
            property?: { name?: unknown; type?: unknown };
            type?: unknown;
        };
    };

    return candidate.callee?.type === 'MemberExpression'
        && candidate.callee.computed === false
        && candidate.callee.property?.type === 'Identifier'
        && candidate.callee.property.name === 'catch';
};

const isFunctionCatchHandler = (value: unknown): value is { params: unknown[]; type: 'ArrowFunctionExpression' | 'FunctionExpression' } => {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as { params?: unknown; type?: unknown };

    return (
        (candidate.type === 'ArrowFunctionExpression' || candidate.type === 'FunctionExpression')
        && Array.isArray(candidate.params)
    );
};

const readHasReferencedErrorParameter = (
    context: Rule.RuleContext,
    node: unknown,
) => (
    context.getDeclaredVariables(node as DeclaredVariableNode).some((variable) => variable.references.length > 0)
);

export const noSilentCatchRule: Rule.RuleModule = {
    meta: {
        docs: {
            description: 'Disallow bare catch blocks and silent Promise.catch handlers.',
        },
        schema: [],
        type: 'problem',
    },
    create(context) {
        return {
            CatchClause(node) {
                if (!node.param) {
                    context.report({
                        node,
                        message: 'Catch clauses must declare an error parameter and handle it explicitly.',
                    });
                    return;
                }

                if (!readHasReferencedErrorParameter(context, node)) {
                    context.report({
                        node,
                        message: 'Silent catch blocks are not allowed. Consume the error in logging, suppression helpers, or recovery logic.',
                    });
                }
            },
            CallExpression(node) {
                if (!isCatchCallback(node)) {
                    return;
                }

                const callback = node.arguments[0];

                if (!callback) {
                    return;
                }

                if (!isFunctionCatchHandler(callback)) {
                    return;
                }

                if (callback.params.length === 0) {
                    context.report({
                        node: callback,
                        message: 'Promise.catch handlers must declare an error parameter and handle it explicitly.',
                    });
                    return;
                }

                if (!readHasReferencedErrorParameter(context, callback)) {
                    context.report({
                        node: callback,
                        message: 'Silent Promise.catch handlers are not allowed. Consume the error in logging, suppression helpers, or recovery logic.',
                    });
                }
            },
        };
    },
};