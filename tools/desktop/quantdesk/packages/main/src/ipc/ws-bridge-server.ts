import { WebSocketServer, type RawData, type WebSocket } from 'ws';

import { listIpcContractEntries } from '@quantdesk/shared/ipc-contract';

import type { LoggerLike } from '../logger';
import type { IpcHandlerMap } from './contract-binder';
import type { RuntimeRequestContext } from './runtime';

interface JsonRpcRequest {
    id?: number | string;
    jsonrpc?: '2.0';
    method?: string;
    params?: unknown;
}

interface JsonRpcSuccess {
    id: number | string;
    jsonrpc: '2.0';
    result: unknown;
}

interface JsonRpcError {
    id: number | string | null;
    jsonrpc: '2.0';
    error: {
        code: number;
        message: string;
    };
}

export interface WsBridgeServerOptions {
    host?: string;
    logger?: LoggerLike;
}

const defaultInvokeTimeoutMs = 20_000;

const serialize = (message: JsonRpcSuccess | JsonRpcError | { jsonrpc: '2.0'; method: string; params: unknown[] }) =>
    JSON.stringify(message);

const toParamsArray = (params: unknown) => {
    if (params === undefined) {
        return [];
    }

    return Array.isArray(params) ? params : [params];
};

const withTimeout = async (promise: Promise<unknown>, timeoutMs: number, method: string) => {
    return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error(`WS bridge handler timed out: ${method} (${timeoutMs}ms)`));
            }, timeoutMs);

            void promise.finally(() => clearTimeout(timeout));
        }),
    ]);
};

export class WsBridgeServer {
    private server: WebSocketServer | null = null;

    private readonly options: WsBridgeServerOptions;

    private readonly host: string;

    private invokeHandlers: IpcHandlerMap['invoke'] = {};

    private sendHandlers: IpcHandlerMap['send'] = {};

    private readonly timeoutByChannel = new Map<string, number>();

    constructor(options: WsBridgeServerOptions = {}) {
        this.options = options;
        this.host = options.host ?? '127.0.0.1';

        for (const entry of listIpcContractEntries()) {
            if (entry.transport !== 'invoke') {
                continue;
            }

            this.timeoutByChannel.set(entry.channel, entry.timeoutMs ?? defaultInvokeTimeoutMs);
        }
    }

    useHandlers(handlers: IpcHandlerMap) {
        this.invokeHandlers = handlers.invoke;
        this.sendHandlers = handlers.send;
        return this;
    }

    async start(port = Number.parseInt(process.env.QUANTDESK_WS_BRIDGE_PORT ?? '9876', 10)) {
        if (this.server) {
            const address = this.server.address();
            return typeof address === 'object' && address != null ? address.port : port;
        }

        const resolvedPort = await new Promise<number>((resolve, reject) => {
            const server = new WebSocketServer({ host: this.host, port });

            server.once('error', reject);
            server.once('listening', () => {
                server.off('error', reject);
                this.server = server;
                server.on('connection', (socket) => {
                    socket.on('message', (data: RawData) => {
                        void this.handleMessage(socket, data.toString());
                    });
                });

                const address = server.address();
                if (typeof address === 'object' && address != null) {
                    resolve(address.port);
                    return;
                }

                resolve(port);
            });
        });

        return resolvedPort;
    }

    async stop() {
        if (!this.server) {
            return;
        }

        const server = this.server;
        this.server = null;

        for (const client of server.clients) {
            client.close();
        }

        await new Promise<void>((resolve, reject) => {
            server.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }

                resolve();
            });
        });
    }

    broadcastEvent(channel: string, payload: unknown) {
        if (!this.server) {
            return;
        }

        for (const client of this.server.clients) {
            this.sendEvent(client, channel, payload);
        }
    }

    private buildRequestContext(socket: WebSocket): RuntimeRequestContext {
        return {
            sender: {
                send: (channel, data) => {
                    this.sendEvent(socket, channel, data);
                },
            },
            transport: 'ws-bridge',
        };
    }

    private sendEvent(socket: WebSocket, channel: string, payload: unknown) {
        if (socket.readyState !== socket.OPEN) {
            return;
        }

        socket.send(serialize({ jsonrpc: '2.0', method: channel, params: [payload] }));
    }

    private sendResult(socket: WebSocket, id: number | string, result: unknown) {
        if (socket.readyState !== socket.OPEN) {
            return;
        }

        socket.send(serialize({ id, jsonrpc: '2.0', result }));
    }

    private sendError(socket: WebSocket, id: number | string | null, message: string) {
        if (socket.readyState !== socket.OPEN) {
            return;
        }

        socket.send(serialize({
            error: {
                code: -32000,
                message,
            },
            id,
            jsonrpc: '2.0',
        }));
    }

    private async handleMessage(socket: WebSocket, rawMessage: string) {
        let payload: JsonRpcRequest;

        try {
            payload = JSON.parse(rawMessage) as JsonRpcRequest;
        } catch (error) {
            this.options.logger?.warn('main', 'WS bridge received non-JSON payload', {
                error: error instanceof Error ? error.message : String(error),
                rawMessage: rawMessage.slice(0, 200),
            });
            return;
        }

        const method = typeof payload.method === 'string' ? payload.method : null;

        if (!method) {
            this.sendError(socket, payload.id ?? null, 'Invalid request: missing method.');
            return;
        }

        const args = toParamsArray(payload.params);
        const event = this.buildRequestContext(socket);

        if (payload.id != null) {
            const handler = this.invokeHandlers[method];

            if (!handler) {
                this.sendError(socket, payload.id, `Unknown invoke channel: ${method}`);
                return;
            }

            try {
                const result = await withTimeout(
                    Promise.resolve(handler(event, ...args)),
                    this.timeoutByChannel.get(method) ?? defaultInvokeTimeoutMs,
                    method,
                );
                this.sendResult(socket, payload.id, result);
            } catch (error) {
                this.sendError(socket, payload.id, error instanceof Error ? error.message : String(error));
            }

            return;
        }

        const handler = this.sendHandlers[method];

        if (!handler) {
            this.options.logger?.warn('main', 'WS bridge received unknown notification', { method });
            return;
        }

        try {
            await Promise.resolve(handler(event, ...args));
        } catch (error) {
            this.options.logger?.warn('main', 'WS bridge notification handler failed', {
                error: error instanceof Error ? error.message : String(error),
                method,
            });
        }
    }
}