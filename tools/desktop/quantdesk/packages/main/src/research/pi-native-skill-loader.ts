import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface LoadPiNativeResearchSkillOptions {
    cwd?: string;
    skillPath?: string;
    startDir?: string;
}

const skillRelativePath = path.join('.agents', 'skills', 'quantdesk-research', 'SKILL.md');

const stripFrontmatter = (content: string) => content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();

const findSkillPath = (startDir: string) => {
    let current = path.resolve(startDir);

    for (; ;) {
        const candidate = path.join(current, skillRelativePath);

        if (existsSync(candidate)) {
            return candidate;
        }

        if (current === path.dirname(current)) {
            return null;
        }

        current = path.dirname(current);
    }
};

const findFirstExistingSkillPath = (candidatePaths: Array<string | null | undefined>) => {
    for (const candidatePath of candidatePaths) {
        if (typeof candidatePath === 'string' && candidatePath.length > 0 && existsSync(candidatePath)) {
            return candidatePath;
        }
    }

    return null;
};

export const resolvePiNativeResearchSkillPath = ({ cwd = process.cwd(), skillPath, startDir = __dirname }: LoadPiNativeResearchSkillOptions = {}) => {
    const configuredSkillPath = skillPath
        ? path.resolve(skillPath)
        : process.env.QUANTDESK_PI_NATIVE_RESEARCH_SKILL_PATH
            ? path.resolve(process.env.QUANTDESK_PI_NATIVE_RESEARCH_SKILL_PATH)
            : null;

    if (configuredSkillPath && !existsSync(configuredSkillPath)) {
        throw new Error(`Configured QuantDesk native research skill does not exist: ${configuredSkillPath}`);
    }

    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    const existingSkillPath = findFirstExistingSkillPath([
        configuredSkillPath,
        findSkillPath(startDir),
        resourcesPath ? path.join(resourcesPath, skillRelativePath) : null,
        resourcesPath ? path.join(resourcesPath, 'app.asar.unpacked', skillRelativePath) : null,
        findSkillPath(cwd),
    ]);

    if (existingSkillPath) {
        return existingSkillPath;
    }

    return path.join(path.resolve(cwd), skillRelativePath);
};

export const loadPiNativeResearchSkill = async (options: LoadPiNativeResearchSkillOptions = {}) => {
    const resolvedPath = resolvePiNativeResearchSkillPath(options);

    try {
        return stripFrontmatter(await readFile(resolvedPath, 'utf8'));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Unable to load QuantDesk native research skill at ${resolvedPath}: ${message}`);
    }
};