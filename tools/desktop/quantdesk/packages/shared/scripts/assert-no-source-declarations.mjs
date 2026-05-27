import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(scriptDir, '../src');

const findSourceDeclarations = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    const matches = [];

    for (const entry of entries) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            matches.push(...await findSourceDeclarations(entryPath));
            continue;
        }

        if (entry.isFile() && entry.name.endsWith('.d.ts')) {
            matches.push(path.relative(sourceRoot, entryPath));
        }
    }

    return matches;
};

const declarations = await findSourceDeclarations(sourceRoot);

if (declarations.length > 0) {
    const formattedMatches = declarations.map((file) => `  - src/${file}`).join('\n');
    console.error([
        'Found generated declaration files inside packages/shared/src.',
        'Declaration output must be emitted to dist only.',
        formattedMatches,
    ].join('\n'));
    process.exitCode = 1;
}