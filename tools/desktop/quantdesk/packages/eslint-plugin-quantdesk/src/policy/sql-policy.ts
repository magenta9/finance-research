import type { PolicyPathEntry } from './path-policy';

export const directSqlAllowlist: PolicyPathEntry[] = [
    {
        path: 'packages/main/src/db/**',
        reason: 'Direct SQL is restricted to the DB layer and repository implementation files.',
    },
];