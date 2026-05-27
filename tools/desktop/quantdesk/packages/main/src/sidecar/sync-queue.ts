import crypto from 'node:crypto';

import type {
    SyncEventRecord,
    SyncStatus,
    SyncTaskKind,
    SyncTaskPriority,
    SyncTaskSnapshot,
} from '@quantdesk/shared';

export interface SyncTaskResult {
    taskId: string;
    key: string;
    kind: SyncTaskKind;
    target: string;
    startDate: string;
    endDate: string;
    priority: SyncTaskPriority;
    attemptedSources: string[];
    insertedRows: number;
    warnings: string[];
    details?: unknown;
}

export interface SyncTask {
    key: string;
    kind: SyncTaskKind;
    target: string;
    startDate: string;
    endDate: string;
    priority: SyncTaskPriority;
    execute: () => Promise<Omit<SyncTaskResult, 'endDate' | 'key' | 'kind' | 'priority' | 'startDate' | 'target' | 'taskId'>>;
}

interface TaskRecord {
    readonly deferred: {
        promise: Promise<SyncTaskResult>;
        reject: (reason?: unknown) => void;
        resolve: (value: SyncTaskResult) => void;
    };
    readonly execute: SyncTask['execute'];
    readonly snapshot: SyncTaskSnapshot;
}

const createDeferred = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((promiseResolve, promiseReject) => {
        resolve = promiseResolve;
        reject = promiseReject;
    });

    return { promise, reject, resolve };
};

const wait = async (timeoutMs: number) => {
    if (timeoutMs <= 0) {
        return;
    }

    await new Promise<void>((resolve) => {
        setTimeout(resolve, timeoutMs);
    });
};

export class SyncQueue {
    private readonly backgroundDelayMs: number;

    private readonly listeners = new Set<(status: SyncStatus) => void>();

    private readonly maxRecentEvents: number;

    private readonly pending: TaskRecord[] = [];

    private readonly tasksByKey = new Map<string, TaskRecord>();

    private activeTask: TaskRecord | null = null;

    private completedTasks = 0;

    private failedTasks = 0;

    private isDraining = false;

    private lastWarning: string | null = null;

    private recentEvents: SyncEventRecord[] = [];

    private shuttingDown = false;

    constructor(options?: { backgroundDelayMs?: number; maxRecentEvents?: number }) {
        this.backgroundDelayMs = options?.backgroundDelayMs ?? 1_500;
        this.maxRecentEvents = options?.maxRecentEvents ?? 25;
    }

    enqueue(task: SyncTask): Promise<SyncTaskResult> {
        return this.enqueueInternal(task, task.priority === 'interactive');
    }

    enqueueFront(task: SyncTask): Promise<SyncTaskResult> {
        return this.enqueueInternal(task, true);
    }

    async promote(taskKey: string): Promise<SyncTaskResult | null> {
        const existing = this.tasksByKey.get(taskKey);

        if (!existing) {
            return null;
        }

        existing.snapshot.priority = 'interactive';

        const index = this.pending.findIndex((entry) => entry.snapshot.key === taskKey);
        if (index >= 0) {
            const [record] = this.pending.splice(index, 1);
            this.pending.unshift(record);
        }

        this.emit();
        return await existing.deferred.promise;
    }

    getStatus(): SyncStatus {
        return {
            running: this.activeTask != null || this.pending.length > 0,
            queuedTasks: this.pending.length,
            activeTask: this.activeTask?.snapshot ?? null,
            completedTasks: this.completedTasks,
            failedTasks: this.failedTasks,
            lastWarning: this.lastWarning,
            recentEvents: [...this.recentEvents],
        };
    }

    subscribe(listener: (status: SyncStatus) => void): () => void {
        this.listeners.add(listener);
        listener(this.getStatus());

        return () => {
            this.listeners.delete(listener);
        };
    }

    async shutdown(): Promise<void> {
        this.shuttingDown = true;

        for (const record of this.pending.splice(0)) {
            this.tasksByKey.delete(record.snapshot.key);
            record.deferred.reject(new Error('Sync queue is shutting down.'));
        }

        this.emit();

        if (this.activeTask) {
            await this.activeTask.deferred.promise.catch((error) => {
                this.lastWarning = error instanceof Error ? error.message : String(error);
            });
        }
    }

    private enqueueInternal(task: SyncTask, front: boolean): Promise<SyncTaskResult> {
        const existing = this.tasksByKey.get(task.key);

        if (existing) {
            if (task.priority === 'interactive') {
                existing.snapshot.priority = 'interactive';
                const index = this.pending.findIndex((entry) => entry.snapshot.key === task.key);
                if (index >= 0) {
                    const [record] = this.pending.splice(index, 1);
                    this.pending.unshift(record);
                }
            }

            this.emit();
            return existing.deferred.promise;
        }

        const snapshot: SyncTaskSnapshot = {
            taskId: crypto.randomUUID(),
            key: task.key,
            kind: task.kind,
            target: task.target,
            startDate: task.startDate,
            endDate: task.endDate,
            priority: task.priority,
            status: 'queued',
        };
        const record: TaskRecord = {
            deferred: createDeferred<SyncTaskResult>(),
            execute: task.execute,
            snapshot,
        };

        this.tasksByKey.set(task.key, record);

        if (front) {
            this.pending.unshift(record);
        } else {
            this.pending.push(record);
        }

        this.emit();
        this.scheduleDrain();
        return record.deferred.promise;
    }

    private emit() {
        const status = this.getStatus();
        for (const listener of this.listeners) {
            listener(status);
        }
    }

    private scheduleDrain() {
        if (this.isDraining) {
            return;
        }

        this.isDraining = true;
        void this.drain();
    }

    private async drain() {
        try {
            while (!this.shuttingDown) {
                const nextTask = this.pending[0];

                if (!nextTask) {
                    return;
                }

                if (
                    nextTask.snapshot.priority === 'background'
                    && (this.completedTasks > 0 || this.failedTasks > 0)
                ) {
                    // The first background task runs immediately; later ones are rate-limited.
                    await wait(this.backgroundDelayMs);

                    if (this.shuttingDown) {
                        return;
                    }
                }

                const record = this.pending.shift();
                if (!record) {
                    return;
                }

                this.activeTask = record;
                record.snapshot.status = 'running';
                this.emit();

                const startedAt = Date.now();

                try {
                    const result = await record.execute();
                    const resolvedResult: SyncTaskResult = {
                        taskId: record.snapshot.taskId,
                        key: record.snapshot.key,
                        kind: record.snapshot.kind,
                        target: record.snapshot.target,
                        startDate: record.snapshot.startDate,
                        endDate: record.snapshot.endDate,
                        priority: record.snapshot.priority,
                        attemptedSources: result.attemptedSources,
                        insertedRows: result.insertedRows,
                        warnings: result.warnings,
                        details: result.details,
                    };

                    this.completedTasks += 1;
                    this.lastWarning = result.warnings.at(-1) ?? this.lastWarning;
                    this.pushRecentEvent({
                        taskId: resolvedResult.taskId,
                        kind: resolvedResult.kind,
                        target: resolvedResult.target,
                        startDate: resolvedResult.startDate,
                        endDate: resolvedResult.endDate,
                        priority: resolvedResult.priority,
                        attemptedSources: resolvedResult.attemptedSources,
                        insertedRows: resolvedResult.insertedRows,
                        warnings: resolvedResult.warnings,
                        durationMs: Date.now() - startedAt,
                        outcome: resolvedResult.warnings.length > 0 ? 'warning' : 'success',
                        occurredAt: new Date().toISOString(),
                        error: null,
                    });
                    record.deferred.resolve(resolvedResult);
                } catch (error) {
                    this.failedTasks += 1;
                    const message = error instanceof Error ? error.message : String(error);
                    this.lastWarning = message;
                    this.pushRecentEvent({
                        taskId: record.snapshot.taskId,
                        kind: record.snapshot.kind,
                        target: record.snapshot.target,
                        startDate: record.snapshot.startDate,
                        endDate: record.snapshot.endDate,
                        priority: record.snapshot.priority,
                        attemptedSources: [],
                        insertedRows: 0,
                        warnings: [],
                        durationMs: Date.now() - startedAt,
                        outcome: 'failed',
                        occurredAt: new Date().toISOString(),
                        error: message,
                    });
                    record.deferred.reject(error);
                } finally {
                    this.tasksByKey.delete(record.snapshot.key);
                    this.activeTask = null;
                    this.emit();
                }
            }
        } finally {
            this.isDraining = false;
            if (!this.shuttingDown && this.pending.length > 0) {
                this.scheduleDrain();
            }
        }
    }

    private pushRecentEvent(event: SyncEventRecord) {
        this.recentEvents = [event, ...this.recentEvents].slice(0, this.maxRecentEvents);
    }
}