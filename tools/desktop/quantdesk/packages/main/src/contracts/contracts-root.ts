import { existsSync } from 'node:fs';
import path from 'node:path';

export interface ResolveContractsRootOptions {
    override?: string;
    startDir?: string;
}

const isContractsRoot = (candidatePath: string) => (
    existsSync(path.join(candidatePath, 'market-data-policy.schema.json'))
    || existsSync(path.join(candidatePath, 'researcher-output.schema.json'))
);

const findFirstExistingPath = (candidatePaths: Array<string | null | undefined>) => {
    for (const candidatePath of candidatePaths) {
        if (typeof candidatePath !== 'string' || candidatePath.length === 0) {
            continue;
        }

        if (existsSync(candidatePath) && isContractsRoot(candidatePath)) {
            return candidatePath;
        }
    }

    return null;
};

const findContractsRoot = (startDir: string) => {
    let currentDir = startDir;

    for (; ;) {
        const candidateRoot = path.join(currentDir, 'contracts');

        if (existsSync(candidateRoot) && isContractsRoot(candidateRoot)) {
            return candidateRoot;
        }

        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) {
            return null;
        }

        currentDir = parentDir;
    }
};

export const resolveContractsRoot = ({ override, startDir = __dirname }: ResolveContractsRootOptions = {}) => {
    const configuredContractsRoot = override
        ? path.resolve(override)
        : process.env.QUANTDESK_CONTRACTS_ROOT
            ? path.resolve(process.env.QUANTDESK_CONTRACTS_ROOT)
            : null;
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    const existingContractsRoot = findFirstExistingPath([
        configuredContractsRoot,
        findContractsRoot(startDir),
        resourcesPath ? path.join(resourcesPath, 'contracts') : null,
        resourcesPath ? path.join(resourcesPath, 'app.asar.unpacked', 'contracts') : null,
        findContractsRoot(process.cwd()),
    ]);

    if (existingContractsRoot) {
        return existingContractsRoot;
    }

    if (configuredContractsRoot) {
        throw new Error(`Configured QuantDesk contracts directory does not exist: ${configuredContractsRoot}`);
    }

    throw new Error('Unable to locate the QuantDesk contracts directory.');
};