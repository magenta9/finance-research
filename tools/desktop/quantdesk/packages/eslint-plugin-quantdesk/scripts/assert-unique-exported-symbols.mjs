import fs from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

const scriptDir = path.dirname(new URL(import.meta.url).pathname);
const defaultRoot = path.resolve(scriptDir, '../..');
const providedRoot = process.argv[2] ? path.resolve(process.argv[2]) : defaultRoot;
const scanRoot = fs.existsSync(path.join(providedRoot, 'packages'))
    ? path.join(providedRoot, 'packages')
    : providedRoot;
const shouldIgnoreFixtures = !scanRoot.replace(/\\/g, '/').includes('/fixtures/');

const isSourceFile = (filePath) => {
    const normalized = filePath.replace(/\\/g, '/');

    return (
        (normalized.endsWith('.ts') || normalized.endsWith('.tsx'))
        && !normalized.endsWith('.d.ts')
        && !normalized.includes('/dist/')
        && !normalized.includes('/node_modules/')
        && (!shouldIgnoreFixtures || !normalized.includes('/fixtures/'))
        && !normalized.includes('/release/')
        && !/\.(test|spec)\.(ts|tsx)$/.test(normalized)
    );
};

const readBindingNames = (name) => {
    if (ts.isIdentifier(name)) {
        return [name.text];
    }

    if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
        return name.elements.flatMap((element) => (
            ts.isBindingElement(element) ? readBindingNames(element.name) : []
        ));
    }

    return [];
};

const hasExportModifier = (node) => (
    ts.canHaveModifiers(node)
    && ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
);

const collectExportedNames = (sourceFile) => {
    const names = new Set();

    for (const statement of sourceFile.statements) {
        if (
            (ts.isFunctionDeclaration(statement)
                || ts.isClassDeclaration(statement)
                || ts.isInterfaceDeclaration(statement)
                || ts.isTypeAliasDeclaration(statement)
                || ts.isEnumDeclaration(statement))
            && hasExportModifier(statement)
            && statement.name
        ) {
            names.add(statement.name.text);
            continue;
        }

        if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
            for (const declaration of statement.declarationList.declarations) {
                for (const name of readBindingNames(declaration.name)) {
                    names.add(name);
                }
            }
            continue;
        }

        if (
            ts.isExportDeclaration(statement)
            && !statement.moduleSpecifier
            && statement.exportClause
            && ts.isNamedExports(statement.exportClause)
        ) {
            for (const element of statement.exportClause.elements) {
                names.add(element.name.text);
            }
        }
    }

    return [...names];
};

const walk = (directory) => {
    const files = [];

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);

        if (entry.isDirectory()) {
            files.push(...walk(entryPath));
            continue;
        }

        if (entry.isFile() && isSourceFile(entryPath)) {
            files.push(entryPath);
        }
    }

    return files;
};

const sourceFiles = walk(scanRoot);
const occurrences = new Map();

for (const filePath of sourceFiles) {
    const sourceText = fs.readFileSync(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);
    const relativePath = path.relative(providedRoot, filePath).replace(/\\/g, '/');

    for (const name of collectExportedNames(sourceFile)) {
        const current = occurrences.get(name) ?? [];
        current.push(relativePath);
        occurrences.set(name, current);
    }
}

const duplicates = [...occurrences.entries()]
    .filter(([, files]) => new Set(files).size > 1)
    .sort(([left], [right]) => left.localeCompare(right));

if (duplicates.length > 0) {
    console.error('Found duplicate exported top-level symbols:');

    for (const [name, files] of duplicates) {
        console.error(`- ${name}`);

        for (const file of [...new Set(files)].sort()) {
            console.error(`  - ${file}`);
        }
    }

    process.exitCode = 1;
} else {
    console.log('Exported top-level symbols are globally unique.');
}