import WebSocket, { type RawData } from 'ws';

import type { LoggerLike } from '../logger';

interface JsonRpcSuccess<T> {
    id: number;
    jsonrpc: '2.0';
    result: T;
}

interface JsonRpcFailure {
    id: number | null;
    jsonrpc: '2.0';
    error: {
        code: number;
        message: string;
        data?: unknown;
    };
}

type JsonRpcResponse<T> = JsonRpcSuccess<T> | JsonRpcFailure;

interface PendingRequest {
    reject: (error: Error) => void;
    resolve: (value: unknown) => void;
    timeout: NodeJS.Timeout;
}

export class RpcClient {
    private socket: WebSocket | null = null;

    private nextId = 1;

    private readonly pending = new Map<number, PendingRequest>();

    private readonly onClose?: () => void;

    private readonly logger?: LoggerLike;

    constructor(
        onClose?: () => void,
        logger?: LoggerLike,
    ) {
        this.onClose = onClose;
        this.logger = logger;
    }

    async connect(url: string) {
        if (this.socket?.readyState === WebSocket.OPEN) {
            return;
        }

        await new Promise<void>((resolve, reject) => {
            const socket = new WebSocket(url);
            this.socket = socket;

            const cleanup = () => {
                socket.off('open', handleOpen);
                socket.off('error', handleError);
            };

            const handleOpen = () => {
                cleanup();
                resolve();
            };

            const handleError = (error: Error) => {
                cleanup();
                reject(error);
            };

            socket.on('message', (data: RawData) => {
                this.handleMessage(data.toString());
            });

            socket.on('close', () => {
                this.socket = null;
                this.rejectAll(new Error('JSON-RPC websocket closed.'));
                this.onClose?.();
            });

            socket.once('open', handleOpen);
            socket.once('error', handleError);
        });
    }

    isConnected() {
        return this.socket?.readyState === WebSocket.OPEN;
    }

    async call<T>(method: string, params?: unknown, timeoutMs = 30_000): Promise<T> {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            throw new Error('JSON-RPC websocket is not connected.');
        }

        const id = this.nextId++;

        return await new Promise<T>((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`RPC ${method} timed out after ${timeoutMs}ms.`));
            }, timeoutMs);

            this.pending.set(id, {
                resolve: (value) => {
                    resolve(value as T);
                },
                reject,
                timeout,
            });

            this.socket?.send(
                JSON.stringify({
                    id,
                    jsonrpc: '2.0',
                    method,
                    params,
                }),
            );
        });
    }

    notify(method: string, params?: unknown) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            return;
        }

        this.socket.send(
            JSON.stringify({
                jsonrpc: '2.0',
                method,
                params,
            }),
        );
    }

    async close() {
        if (!this.socket) {
            return;
        }

        const socket = this.socket;
        this.socket = null;

        await new Promise<void>((resolve) => {
            if (socket.readyState === WebSocket.CLOSED) {
                resolve();
                return;
            }

            socket.once('close', () => resolve());
            socket.close();
        });
    }

    private handleMessage(rawMessage: string) {
        let payload: JsonRpcResponse<unknown>;

        try {
            payload = JSON.parse(rawMessage) as JsonRpcResponse<unknown>;
        } catch (error) {
            this.logger?.warn('main', 'Received non-JSON message from sidecar', {
                error: error instanceof Error ? error.message : String(error),
                rawMessage: String(rawMessage).slice(0, 200),
            });
            return;
        }

        if (payload.id == null) {
            return;
        }

        const pending = this.pending.get(payload.id);

        if (!pending) {
            return;
        }

        clearTimeout(pending.timeout);
        this.pending.delete(payload.id);

        if ('error' in payload) {
            pending.reject(
                new Error(payload.error.message, {
                    cause: payload.error.data,
                }),
            );
            return;
        }

        pending.resolve(payload.result);
    }

    private rejectAll(error: Error) {
        for (const [id, pending] of this.pending.entries()) {
            clearTimeout(pending.timeout);
            pending.reject(error);
            this.pending.delete(id);
        }
    }
}
