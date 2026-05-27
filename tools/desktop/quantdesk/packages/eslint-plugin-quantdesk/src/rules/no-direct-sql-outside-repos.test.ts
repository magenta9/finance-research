import { describe, expect, test } from 'vitest';

import { noDirectSqlOutsideReposRule } from './no-direct-sql-outside-repos';
import { lintWithRule } from '../test-utils';

describe('no-direct-sql-outside-repos rule', () => {
    test('reports database.prepare calls outside the db layer', () => {
        const messages = lintWithRule({
            code: 'database.prepare("select 1").get();',
            filename: 'packages/main/src/ipc/system.ts',
            rule: noDirectSqlOutsideReposRule,
            ruleName: 'quantdesk/no-direct-sql-outside-repos',
        });

        expect(messages).toHaveLength(1);
        expect(messages[0]?.message).toContain('Direct SQL is only allowed');
    });

    test('allows database.prepare calls inside the db layer', () => {
        const messages = lintWithRule({
            code: 'database.prepare("select 1").get();',
            filename: 'packages/main/src/db/repos/example-repository.ts',
            rule: noDirectSqlOutsideReposRule,
            ruleName: 'quantdesk/no-direct-sql-outside-repos',
        });

        expect(messages).toHaveLength(0);
    });

    test('ignores non-SQL prepare calls outside the db layer', () => {
        const messages = lintWithRule({
            code: 'preparationService.prepare({ assetIds: ["spy"] });',
            filename: 'packages/main/src/portfolio/engine.ts',
            rule: noDirectSqlOutsideReposRule,
            ruleName: 'quantdesk/no-direct-sql-outside-repos',
        });

        expect(messages).toHaveLength(0);
    });
});