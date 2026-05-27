import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { DocsRagService } from './docs-rag-service';

const waitFor = async (predicate: () => Promise<boolean>, timeoutMs = 5_000) => {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        if (await predicate()) {
            return;
        }

        await new Promise((resolve) => setTimeout(resolve, 25));
    }

    throw new Error('Timed out waiting for DocsRagService to update its index.');
};

describe('DocsRagService', () => {
    const services: DocsRagService[] = [];
    const tempDirs: string[] = [];

    afterEach(async () => {
        await Promise.all(services.splice(0).map(async (service) => {
            await service.close();
        }));
        await Promise.all(tempDirs.splice(0).map(async (dirPath) => {
            await fs.rm(dirPath, { force: true, recursive: true });
        }));
    });

    test('indexes markdown docs and exposes them through search results', async () => {
        const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'quantdesk-rag-'));
        tempDirs.push(rootDir);
        await fs.mkdir(path.join(rootDir, 'docs'), { recursive: true });
        await fs.writeFile(
            path.join(rootDir, 'docs', 'overview.md'),
            [
                '---',
                'title: 资产配置概览',
                '---',
                '# 资产配置概览',
                '风险分散要求在多个资产类别之间做长期配置。',
            ].join('\n'),
            'utf8',
        );

        const service = new DocsRagService(rootDir);
        services.push(service);

        await service.ensureReady();

        const result = await service.search('风险 分散');
        const status = service.getStatus();

        expect(status.available).toBe(true);
        expect(status.totalDocs).toBe(1);
        expect(result.citations).toEqual(['[quantdesk-doc:docs/overview.md#1]']);
        expect(result.summary).toContain('资产配置概览');
    });

    test('rebuilds the index when a new doc is added after the watcher starts', async () => {
        const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'quantdesk-rag-'));
        tempDirs.push(rootDir);
        await fs.mkdir(path.join(rootDir, 'docs'), { recursive: true });
        await fs.writeFile(path.join(rootDir, 'docs', 'existing.md'), '# 现有文档\n初始内容', 'utf8');

        const service = new DocsRagService(rootDir);
        services.push(service);

        await service.ensureReady();
        await fs.writeFile(
            path.join(rootDir, 'docs', 'rebalance.md'),
            '# 调仓说明\n调仓建议需要比较目标权重与当前持仓。',
            'utf8',
        );

        await waitFor(async () => {
            const result = await service.search('调仓 建议');
            return result.citations.some((citation) => citation.includes('rebalance.md'));
        });

        const result = await service.search('调仓 建议');

        expect(result.citations.some((citation) => citation.includes('rebalance.md'))).toBe(true);
    });
});