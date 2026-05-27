import fs from 'node:fs';
import path from 'node:path';

import { Linter } from 'eslint';
import parser from '@typescript-eslint/parser';
import type { Rule } from 'eslint';

const fixtureRoot = path.resolve(__dirname, '../fixtures');

export const readFixture = (relativePath: string) => (
    fs.readFileSync(path.join(fixtureRoot, relativePath), 'utf8')
);

export const lintWithRule = ({
    code,
    filename,
    rule,
    ruleName,
}: {
    code: string;
    filename: string;
    rule: Rule.RuleModule;
    ruleName: string;
}) => {
    const linter = new Linter();

    linter.defineParser('@typescript-eslint/parser', parser as never);
    linter.defineRule(ruleName, rule);

    return linter.verify(
        code,
        {
            parser: '@typescript-eslint/parser',
            parserOptions: {
                ecmaFeatures: {
                    jsx: true,
                },
                ecmaVersion: 'latest',
                sourceType: 'module',
            },
            rules: {
                [ruleName]: 'error',
            },
        },
        filename,
    );
};