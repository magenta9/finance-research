import type { QuantdeskApi } from '@quantdesk/shared/types/api';
import type { IpcContractEntry } from '@quantdesk/shared/ipc-contract';
import { createQuantdeskApiFromPort, type QuantdeskPort } from '@quantdesk/shared/quantdesk-port';

const defaultInvokeTimeoutMs = 20_000;

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
        data?: unknown;
        message: string;
    };
}

type JsonRpcResponse<T> = JsonRpcSuccess<T> | JsonRpcFailure;

interface PendingRequest {
    reject: (error: Error) => void;
    resolve: (value: unknown) => void;
    timeout: ReturnType<typeof setTimeout>;
}

const reportBridgeTransportError = (message: string, error: unknown, context?: Record<string, unknown>) => {
    console.warn(`[renderer] ${message}`, {
        ...context,
        error: error instanceof Error ? error.message : String(error),
    });
};

class WsBridgeTransport {
    private connectPromise: Promise<void> | null = null;

    private readonly listeners = new Map<string, Set<(payload: unknown) => void>>();

    private nextId = 1;

    private readonly pending = new Map<number, PendingRequest>();

    private wsUrl: string | null = null;

    private socket: WebSocket | null = null;

    async connect(url: string, timeoutMs = 5_000) {
        this.wsUrl = url;

        if (this.socket?.readyState === WebSocket.OPEN) {
            return;
        }

        if (this.connectPromise) {
            return await this.connectPromise;
        }

        this.connectPromise = new Promise<void>((resolve, reject) => {
            const socket = new WebSocket(url);
            this.socket = socket;
            let settled = false;

            const timeout = setTimeout(() => {
                if (settled) {
                    return;
                }

                settled = true;
                socket.close();
                this.socket = null;
                this.connectPromise = null;
                reject(new Error(`连接 WS bridge 超时：${timeoutMs}ms`));
            }, timeoutMs);

            const cleanup = () => {
                clearTimeout(timeout);
                socket.removeEventListener('open', handleOpen);
                socket.removeEventListener('error', handleError);
            };

            const handleOpen = () => {
                if (settled) {
                    return;
                }

                settled = true;
                cleanup();
                this.connectPromise = null;
                resolve();
            };

            const handleError = () => {
                if (settled) {
                    return;
                }

                settled = true;
                cleanup();
                this.socket = null;
                this.connectPromise = null;
                reject(new Error(`无法连接到 WS bridge：${url}`));
            };

            socket.addEventListener('message', (event) => {
                this.handleMessage(String(event.data));
            });
            socket.addEventListener('close', () => {
                this.socket = null;
                this.connectPromise = null;
                this.rejectAll(new Error('WS bridge 连接已关闭。'));
            });
            socket.addEventListener('open', handleOpen, { once: true });
            socket.addEventListener('error', handleError, { once: true });
        });

        return await this.connectPromise;
    }

    private async ensureConnected() {
        if (!this.wsUrl) {
            throw new Error('WS bridge URL 未初始化。');
        }

        await this.connect(this.wsUrl);
    }

    async call<T>(method: string, params: unknown[], timeoutMs = defaultInvokeTimeoutMs): Promise<T> {
        await this.ensureConnected();

        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            throw new Error('WS bridge 尚未连接。');
        }

        const id = this.nextId++;

        return await new Promise<T>((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`WS bridge 调用超时：${method}（${timeoutMs}ms）`));
            }, timeoutMs);

            this.pending.set(id, {
                reject,
                resolve: (value) => resolve(value as T),
                timeout,
            });

            this.socket?.send(JSON.stringify({ id, jsonrpc: '2.0', method, params }));
        });
    }

    notify(method: string, params: unknown[]) {
        void this.ensureConnected()
            .then(() => {
                if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
                    return;
                }

                this.socket.send(JSON.stringify({ jsonrpc: '2.0', method, params }));
            })
            .catch((error) => {
                reportBridgeTransportError('WS bridge notify failed.', error, { method });
            });
    }

    subscribe(channel: string, listener: (payload: unknown) => void) {
        const listeners = this.listeners.get(channel) ?? new Set<(payload: unknown) => void>();
        listeners.add(listener);
        this.listeners.set(channel, listeners);

        return () => {
            const current = this.listeners.get(channel);

            if (!current) {
                return;
            }

            current.delete(listener);
            if (current.size === 0) {
                this.listeners.delete(channel);
            }
        };
    }

    private emit(channel: string, payload: unknown) {
        const listeners = this.listeners.get(channel);

        if (!listeners) {
            return;
        }

        for (const listener of listeners) {
            listener(payload);
        }
    }

    private handleMessage(rawMessage: string) {
        let payload: JsonRpcResponse<unknown> | { jsonrpc?: '2.0'; method?: string; params?: unknown[] };

        try {
            payload = JSON.parse(rawMessage) as JsonRpcResponse<unknown> | { jsonrpc?: '2.0'; method?: string; params?: unknown[] };
        } catch (error) {
            reportBridgeTransportError('WS bridge received non-JSON payload.', error, {
                rawMessage: rawMessage.slice(0, 200),
            });
            return;
        }

        if ('method' in payload && typeof payload.method === 'string' && !('id' in payload)) {
            const params = Array.isArray(payload.params) ? payload.params : [];
            this.emit(payload.method, params.length <= 1 ? params[0] : params);
            return;
        }

        if (!('id' in payload) || payload.id == null) {
            return;
        }

        const pending = this.pending.get(payload.id as number);

        if (!pending) {
            return;
        }

        clearTimeout(pending.timeout);
        this.pending.delete(payload.id as number);

        if ('error' in payload) {
            pending.reject(new Error(payload.error.message, { cause: payload.error.data }));
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

const createWsBridgePort = (transport: WsBridgeTransport): QuantdeskPort => ({
    invoke: (_namespace, _method, entry, args) =>
        transport.call((entry as IpcContractEntry).channel, args, (entry as IpcContractEntry).timeoutMs ?? defaultInvokeTimeoutMs) as never,
    send: (_namespace, _method, entry, args) => {
        transport.notify((entry as IpcContractEntry).channel, args);
    },
    subscribe: (_namespace, _method, entry, listener) =>
        transport.subscribe((entry as IpcContractEntry).channel, listener as (payload: unknown) => void) as never,
});

export const createWsBridgeApi = async (wsUrl: string): Promise<QuantdeskApi> => {
    const transport = new WsBridgeTransport();
    await transport.connect(wsUrl);

    return createQuantdeskApiFromPort(createWsBridgePort(transport));
};