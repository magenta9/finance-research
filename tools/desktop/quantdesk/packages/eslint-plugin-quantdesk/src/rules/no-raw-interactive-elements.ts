import type { Rule } from 'eslint';

import { isPolicyAllowed } from '../policy/path-policy';
import { rawInteractiveElementAllowlist } from '../policy/raw-interactive-elements-policy';

const interactiveElements = new Set(['button', 'input', 'select', 'textarea']);

type JsxIdentifierNode = {
    name: string;
    type: 'JSXIdentifier';
};

type JsxAttributeNode = {
    name: JsxIdentifierNode;
    type: 'JSXAttribute';
    value?: {
        type: 'Literal';
        value: unknown;
    } | null;
};

type JsxOpeningElementNode = {
    attributes: unknown[];
    name: unknown;
};

const isJsxIdentifierNode = (value: unknown): value is JsxIdentifierNode => {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as { name?: unknown; type?: unknown };
    return candidate.type === 'JSXIdentifier' && typeof candidate.name === 'string';
};

const isJsxAttributeNode = (value: unknown): value is JsxAttributeNode => {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as { name?: unknown; type?: unknown };
    return candidate.type === 'JSXAttribute' && isJsxIdentifierNode(candidate.name);
};

const readReplacement = (tagName: string, isCheckbox: boolean) => {
    if (tagName === 'button') {
        return 'Button';
    }

    if (tagName === 'select') {
        return 'Select';
    }

    if (tagName === 'textarea') {
        return 'Textarea';
    }

    return isCheckbox ? 'Checkbox' : 'Input';
};

const isCheckboxInput = (node: JsxOpeningElementNode) =>
    node.attributes.some((attribute) =>
        isJsxAttributeNode(attribute)
        && attribute.name.name === 'type'
        && attribute.value?.type === 'Literal'
        && attribute.value.value === 'checkbox');

export const noRawInteractiveElementsRule: Rule.RuleModule = {
    meta: {
        docs: {
            description: 'Disallow rendering native interactive DOM elements outside renderer primitives.',
        },
        schema: [],
        type: 'problem',
    },
    create(context) {
        const filename = context.getFilename();

        if (isPolicyAllowed(filename, rawInteractiveElementAllowlist)) {
            return {};
        }

        return {
            JSXOpeningElement(node: unknown) {
                const openingElement = node as unknown as JsxOpeningElementNode;

                if (!isJsxIdentifierNode(openingElement.name)) {
                    return;
                }

                const tagName = openingElement.name.name;

                if (!interactiveElements.has(tagName)) {
                    return;
                }

                const checkboxInput = tagName === 'input' && isCheckboxInput(openingElement);
                const replacement = readReplacement(tagName, checkboxInput);

                context.report({
                    node: node as never,
                    message: `Use the shared ${replacement} primitive instead of rendering a raw <${tagName}> in renderer routes or regular components.`,
                });
            },
        };
    },
};