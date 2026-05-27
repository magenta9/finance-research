import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { createWsBridgeApi } from './ws-bridge-client';

type Listener = (event: { data?: string }) => void;

class MockWebSocket {
    static readonly CONNECTING = 0;

    static readonly OPEN = 1;

    static readonly CLOSING = 2;

    static readonly CLOSED = 3;

    readonly url: string;

    readyState = MockWebSocket.CONNECTING;

    private readonly listeners = new Map<string, Set<Listener>>();

    readonly sentMessages: string[] = [];

    constructor(url: string) {
        this.url = url;
        mockSockets.push(this);

        queueMicrotask(() => {
            this.readyState = MockWebSocket.OPEN;
            this.dispatch('open');
        });
    }

    addEventListener(type: string, listener: Listener) {
        const current = this.listeners.get(type) ?? new Set<Listener>();
        current.add(listener);
        this.listeners.set(type, current);
    }

    removeEventListener(type: string, listener: Listener) {
        this.listeners.get(type)?.delete(listener);
    }

    send(data: string) {
        this.sentMessages.push(data);

        const message = JSON.parse(data) as { id?: number; method?: string };

        if (message.id == null) {
            return;
        }

        queueMicrotask(() => {
            const response = message.method === 'runtime:get-mode'
                ? { id: message.id, jsonrpc: '2.0', result: 'browser-live' }
                : { id: message.id, jsonrpc: '2.0', result: null };

            this.dispatch('message', { data: JSON.stringify(response) });
        });
    }

    close() {
        if (this.readyState === MockWebSocket.CLOSED) {
            return;
        }

        this.readyState = MockWebSocket.CLOSED;
        this.dispatch('close');
    }

    private dispatch(type: string, event: { data?: string } = {}) {
        for (const listener of this.listeners.get(type) ?? []) {
            listener(event);
        }
    }
}

const mockSockets: MockWebSocket[] = [];

describe('createWsBridgeApi', () => {
    beforeEach(() => {
        mockSockets.length = 0;
        vi.stubGlobal('WebSocket', MockWebSocket);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    test('reconnects automatically after the socket closes', async () => {
        const api = await createWsBridgeApi('ws://127.0.0.1:9876');

        await expect(api.runtime.getMode()).resolves.toBe('browser-live');
        expect(mockSockets).toHaveLength(1);
        expect(mockSockets[0]?.readyState).toBe(MockWebSocket.OPEN);

        mockSockets[0]?.close();

        await expect(api.runtime.getMode()).resolves.toBe('browser-live');
        expect(mockSockets).toHaveLength(2);
        expect(mockSockets[1]?.readyState).toBe(MockWebSocket.OPEN);
    });
});