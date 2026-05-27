import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { loadPiNativeResearchSkill, resolvePiNativeResearchSkillPath } from './pi-native-skill-loader';

const originalResourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
const originalSkillPath = process.env.QUANTDESK_PI_NATIVE_RESEARCH_SKILL_PATH;

const restoreResourcesPath = () => {
    if (originalResourcesPath === undefined) {
        Reflect.deleteProperty(process as NodeJS.Process & { resourcesPath?: string }, 'resourcesPath');
        return;
    }

    Object.defineProperty(process, 'resourcesPath', {
        configurable: true,
        value: originalResourcesPath,
    });
};

describe('pi native research skill loader', () => {
    afterEach(() => {
        restoreResourcesPath();
        if (originalSkillPath === undefined) {
            delete process.env.QUANTDESK_PI_NATIVE_RESEARCH_SKILL_PATH;
        } else {
            process.env.QUANTDESK_PI_NATIVE_RESEARCH_SKILL_PATH = originalSkillPath;
        }
    });

    test('loads a skill file and strips frontmatter', async () => {
        const directory = await mkdtemp(path.join(os.tmpdir(), 'quantdesk-skill-'));
        const skillPath = path.join(directory, 'SKILL.md');

        try {
            await writeFile(skillPath, ['---', 'name: test', '---', '', '# Body', '', 'Rules'].join('\n'));

            await expect(loadPiNativeResearchSkill({ skillPath })).resolves.toBe('# Body\n\nRules');
        } finally {
            await rm(directory, { force: true, recursive: true });
        }
    });

    test('reports the resolved path when the skill is missing', async () => {
        const skillPath = path.join(os.tmpdir(), 'missing-quantdesk-research-skill.md');

        await expect(loadPiNativeResearchSkill({ skillPath })).rejects.toThrow(`Configured QuantDesk Pi native research skill does not exist: ${skillPath}`);
    });

    test('resolves a packaged resourcesPath skill', async () => {
        const directory = await mkdtemp(path.join(os.tmpdir(), 'quantdesk-packaged-skill-'));
        const skillPath = path.join(directory, '.pi', 'skills', 'quantdesk-research', 'SKILL.md');

        try {
            await mkdir(path.dirname(skillPath), { recursive: true });
            await writeFile(skillPath, '# Packaged skill');
            Object.defineProperty(process, 'resourcesPath', {
                configurable: true,
                value: directory,
            });

            expect(resolvePiNativeResearchSkillPath({ cwd: path.join(directory, 'cwd'), startDir: path.join(directory, 'dist') })).toBe(skillPath);
        } finally {
            await rm(directory, { force: true, recursive: true });
        }
    });

    test('prefers the environment skill override', async () => {
        const directory = await mkdtemp(path.join(os.tmpdir(), 'quantdesk-env-skill-'));
        const skillPath = path.join(directory, 'SKILL.md');

        try {
            await writeFile(skillPath, '# Env skill');
            process.env.QUANTDESK_PI_NATIVE_RESEARCH_SKILL_PATH = skillPath;

            expect(resolvePiNativeResearchSkillPath({ cwd: path.join(directory, 'cwd'), startDir: path.join(directory, 'dist') })).toBe(skillPath);
        } finally {
            await rm(directory, { force: true, recursive: true });
        }
    });

    test('resolves an unpacked packaged skill', async () => {
        const directory = await mkdtemp(path.join(os.tmpdir(), 'quantdesk-unpacked-skill-'));
        const skillPath = path.join(directory, 'app.asar.unpacked', '.pi', 'skills', 'quantdesk-research', 'SKILL.md');

        try {
            await mkdir(path.dirname(skillPath), { recursive: true });
            await writeFile(skillPath, '# Unpacked skill');
            Object.defineProperty(process, 'resourcesPath', {
                configurable: true,
                value: directory,
            });

            expect(resolvePiNativeResearchSkillPath({ cwd: path.join(directory, 'cwd'), startDir: path.join(directory, 'dist') })).toBe(skillPath);
        } finally {
            await rm(directory, { force: true, recursive: true });
        }
    });

    test('resolves the repository skill from a nested cwd', () => {
        const resolved = resolvePiNativeResearchSkillPath({ cwd: path.join(process.cwd(), 'packages', 'main', 'src') });

        expect(resolved.endsWith(path.join('.pi', 'skills', 'quantdesk-research', 'SKILL.md'))).toBe(true);
    });
});