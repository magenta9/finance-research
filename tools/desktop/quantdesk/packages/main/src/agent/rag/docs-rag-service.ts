import fs from 'node:fs';
import path from 'node:path';

import chokidar from 'chokidar';
import matter from 'gray-matter';

import type { RagStatus } from '@quantdesk/shared';

const sourceEntries = [
    'docs',
    'thoughts/shared/plans',
    'thoughts/shared/specs',
    'thoughts/shared/explain',
    '.github',
    'README.md',
    'SPEC.md',
    'AGENTS.md',
];

interface RagChunk {
    id: string;
    content: string;
    citation: string;
    path: string;
    title: string;
}

interface SearchChunkResult {
    citation: string;
    excerpt: string;
    path: string;
    score: number;
    title: string;
}

const chunkText = (content: string, size = 1200, overlap = 180) => {
    const normalized = content.replace(/\r\n/g, '\n').trim();
    const chunks: string[] = [];

    for (let start = 0; start < normalized.length; start += Math.max(size - overlap, 300)) {
        const chunk = normalized.slice(start, start + size).trim();

        if (chunk) {
            chunks.push(chunk);
        }
    }

    return chunks;
};

const tokenize = (value: string) => value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 2);

const scoreChunk = (query: string, chunk: RagChunk) => {
    const queryTokens = tokenize(query);

    if (queryTokens.length === 0) {
        return 0;
    }

    const haystack = `${chunk.title}\n${chunk.content}`.toLowerCase();
    return queryTokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
};

const resolveDocsRoot = () => {
    const candidates = [
        process.cwd(),
        path.resolve(__dirname, '../../../../..'),
        path.resolve(__dirname, '../../../../../..'),
    ];

    return candidates.find((candidate) => fs.existsSync(path.join(candidate, 'packages')))
        ?? process.cwd();
};

export class DocsRagService {
    private readonly docsRoot: string;

    private readonly chunkIndex: RagChunk[] = [];

    private readonly errors: RagStatus['errors'] = [];

    private initializationPromise: Promise<void> | null = null;

    private indexing = false;

    private initialized = false;

    private lastIndexedAt: string | null = null;

    private watcher: ReturnType<typeof chokidar.watch> | null = null;

    constructor(rootDir = resolveDocsRoot()) {
        this.docsRoot = rootDir;
    }

    async ensureReady() {
        if (this.initialized) {
            return;
        }

        if (!this.initializationPromise) {
            this.initializationPromise = (async () => {
                await this.rebuildIndex();
                await this.startWatcher();
                this.initialized = true;
            })().catch((error) => {
                this.initializationPromise = null;
                throw error;
            });
        }

        await this.initializationPromise;
    }

    warm() {
        void this.ensureReady();
    }

    async close() {
        await this.watcher?.close();
        this.watcher = null;
    }

    async search(query: string) {
        await this.ensureReady();

        if (this.chunkIndex.length === 0) {
            return {
                citations: [],
                chunks: [] as SearchChunkResult[],
                summary: '当前没有可用的 QuantDesk 文档索引。',
            };
        }

        const chunks = this.chunkIndex
            .map((chunk) => ({
                citation: chunk.citation,
                excerpt: chunk.content.slice(0, 280),
                path: chunk.path,
                score: scoreChunk(query, chunk),
                title: chunk.title,
            }))
            .filter((chunk) => chunk.score > 0)
            .sort((left, right) => right.score - left.score)
            .slice(0, 5);

        if (chunks.length === 0) {
            return {
                citations: [],
                chunks,
                summary: 'QuantDesk 文档索引中没有找到足够相关的段落。',
            };
        }

        return {
            citations: chunks.map((chunk) => chunk.citation),
            chunks,
            summary: chunks
                .map((chunk, index) => `${index + 1}. ${chunk.title}\n${chunk.excerpt}`)
                .join('\n\n'),
        };
    }

    getStatus(): RagStatus {
        return {
            available: this.chunkIndex.length > 0,
            docsRoot: this.docsRoot,
            embeddingModel: null,
            errors: [...this.errors],
            indexing: this.indexing,
            lastIndexedAt: this.lastIndexedAt,
            runtimeMode: 'electron',
            totalChunks: this.chunkIndex.length,
            totalDocs: new Set(this.chunkIndex.map((chunk) => chunk.path)).size,
        };
    }

    private getSourceRoots() {
        return sourceEntries.map((entry) => path.join(this.docsRoot, entry));
    }

    private enumerateSourceFiles() {
        const files: string[] = [];

        const visit = (target: string) => {
            if (!fs.existsSync(target)) {
                return;
            }

            const stat = fs.statSync(target);

            if (stat.isDirectory()) {
                for (const child of fs.readdirSync(target)) {
                    visit(path.join(target, child));
                }
                return;
            }

            if (!target.match(/\.(md|markdown|txt|json)$/i) && !target.endsWith('AGENTS.md') && !target.endsWith('SPEC.md')) {
                return;
            }

            files.push(target);
        };

        this.getSourceRoots().forEach(visit);

        return files;
    }

    private async rebuildIndex() {
        this.indexing = true;
        this.errors.length = 0;
        this.chunkIndex.length = 0;

        try {
            const files = this.enumerateSourceFiles();

            files.forEach((filePath) => {
                try {
                    const raw = fs.readFileSync(filePath, 'utf8');
                    const parsed = matter(raw);
                    const relativePath = path.relative(this.docsRoot, filePath);
                    const title = parsed.data.title
                        ? String(parsed.data.title)
                        : relativePath;

                    chunkText(parsed.content || raw).forEach((chunk, index) => {
                        this.chunkIndex.push({
                            citation: `[quantdesk-doc:${relativePath}#${index + 1}]`,
                            content: chunk,
                            id: `${relativePath}#${index + 1}`,
                            path: relativePath,
                            title,
                        });
                    });
                } catch (error) {
                    this.errors.push({
                        code: 'READ_ERROR',
                        docPath: filePath,
                        id: this.errors.length + 1,
                        message: error instanceof Error ? error.message : String(error),
                        occurredAt: new Date().toISOString(),
                        stage: 'read',
                    });
                }
            });

            this.lastIndexedAt = new Date().toISOString();
        } finally {
            this.indexing = false;
        }
    }

    private async startWatcher() {
        if (this.watcher) {
            return;
        }

        this.watcher = chokidar.watch(this.getSourceRoots().filter((target) => fs.existsSync(target)), {
            ignoreInitial: true,
        });

        this.watcher.on('all', () => {
            void this.rebuildIndex();
        });

        await new Promise<void>((resolve, reject) => {
            const watcher = this.watcher;

            if (!watcher) {
                resolve();
                return;
            }

            const handleReady = () => {
                watcher.off('error', handleError);
                resolve();
            };

            const handleError = (error: unknown) => {
                watcher.off('ready', handleReady);
                reject(error instanceof Error ? error : new Error(String(error)));
            };

            watcher.once('ready', handleReady);
            watcher.once('error', handleError);
        });
    }
}