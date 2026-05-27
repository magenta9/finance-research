import type { Rule } from 'eslint';

const message = 'Routes, stores, and components must not import from renderer dev/. Use the typed window.api boundary instead.';

const normalizePath = (value: string) => value.replace(/\\/g, '/');

const isRestrictedRendererFile = (filename: string) => (
    /(^|\/)packages\/renderer\/src\/(routes|stores|components)\//.test(normalizePath(filename))
);

const isRendererDevImport = (source: string) => {
    const normalized = normalizePath(source);

    return normalized === '@renderer/dev'
        || normalized.startsWith('@renderer/dev/')
        || normalized === 'src/dev'
        || normalized.startsWith('src/dev/')
        || normalized === 'dev'
        || normalized.startsWith('dev/')
        || normalized.endsWith('/dev')
        || normalized.includes('/dev/');
};

const reportIfDevImport = (
    context: Rule.RuleContext,
    node: { source?: unknown },
) => {
    const source = node.source as { type?: string; value?: unknown } | undefined;

    if (source?.type !== 'Literal' || typeof source.value !== 'string') {
        return;
    }

    if (!isRendererDevImport(source.value)) {
        return;
    }

    context.report({
        node: source as never,
        message,
    });
};

export const noRendererDevImportsRule: Rule.RuleModule = {
    meta: {
        docs: {
            description: 'Disallow imports from renderer dev/ inside routes, stores, and components.',
        },
        schema: [],
        type: 'problem',
    },
    create(context) {
        if (!isRestrictedRendererFile(context.getFilename())) {
            return {};
        }

        return {
            ExportAllDeclaration(node) {
                reportIfDevImport(context, node);
            },
            ExportNamedDeclaration(node) {
                reportIfDevImport(context, node);
            },
            ImportDeclaration(node) {
                reportIfDevImport(context, node);
            },
        };
    },
};
