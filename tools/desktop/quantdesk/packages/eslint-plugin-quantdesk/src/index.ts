import { noDirectSqlOutsideReposRule } from './rules/no-direct-sql-outside-repos';
import { noRawInteractiveElementsRule } from './rules/no-raw-interactive-elements';
import { noRendererDevImportsRule } from './rules/no-renderer-dev-imports';
import { noRuntimeDynamicImportRule } from './rules/no-runtime-dynamic-import';
import { noSilentCatchRule } from './rules/no-silent-catch';

export const rules = {
    'no-direct-sql-outside-repos': noDirectSqlOutsideReposRule,
    'no-raw-interactive-elements': noRawInteractiveElementsRule,
    'no-renderer-dev-imports': noRendererDevImportsRule,
    'no-runtime-dynamic-import': noRuntimeDynamicImportRule,
    'no-silent-catch': noSilentCatchRule,
};

export const plugin = {
    rules,
};

export default plugin;