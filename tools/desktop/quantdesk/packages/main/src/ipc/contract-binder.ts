import {
    type QuantdeskApi,
} from '@quantdesk/shared';
import {
    ipcContract,
    listIpcContractEntries,
    type IpcContractEntry,
    type IpcTransport,
} from '@quantdesk/shared/ipc-contract';

type Awaitable<T> = Promise<T> | T;
type NamespaceKey = keyof QuantdeskApi;
type MethodKey<Namespace extends NamespaceKey> = keyof typeof ipcContract[Namespace] & keyof QuantdeskApi[Namespace] & string;

type MethodFn<
    Namespace extends NamespaceKey,
    Method extends MethodKey<Namespace>,
> = QuantdeskApi[Namespace][Method] extends (...args: infer Args) => infer Return
    ? (...args: Args) => Return
    : never;

type MethodArgs<
    Namespace extends NamespaceKey,
    Method extends MethodKey<Namespace>,
> = Parameters<MethodFn<Namespace, Method>>;

type MethodReturn<
    Namespace extends NamespaceKey,
    Method extends MethodKey<Namespace>,
> = ReturnType<MethodFn<Namespace, Method>>;

type ContractMethodEntry<
    Namespace extends NamespaceKey,
    Method extends MethodKey<Namespace>,
> = Extract<(typeof ipcContract)[Namespace][Method], IpcContractEntry>;

type MethodKeyByTransport<
    Namespace extends NamespaceKey,
    Transport extends IpcTransport,
> = {
    [Method in MethodKey<Namespace>]: ContractMethodEntry<Namespace, Method>['transport'] extends Transport ? Method : never;
}[MethodKey<Namespace>];

type SendMethodKey<Namespace extends NamespaceKey> = MethodKeyByTransport<Namespace, 'send'>;
type SubscribeMethodKey<Namespace extends NamespaceKey> = MethodKeyByTransport<Namespace, 'subscribe'>;
type InvokeMethodKey<Namespace extends NamespaceKey> = MethodKeyByTransport<Namespace, 'invoke'>;

type SubscribeListener<
    Namespace extends NamespaceKey,
    Method extends SubscribeMethodKey<Namespace>,
> = MethodArgs<Namespace, Method>[0] extends (payload: infer Payload) => void ? (payload: Payload) => void : never;

type InvokeNamespaceHandlers<Namespace extends NamespaceKey> = Partial<{
    [Method in InvokeMethodKey<Namespace>]: (...args: MethodArgs<Namespace, Method>) => Awaitable<Awaited<MethodReturn<Namespace, Method>>>;
}>;

type SendNamespaceHandlers<Namespace extends NamespaceKey> = Partial<{
    [Method in SendMethodKey<Namespace>]: (...args: MethodArgs<Namespace, Method>) => void;
}>;

interface EventSender {
    send?: (channel: string, data: unknown) => void;
}

type IpcBindingListener = (event: unknown, ...args: unknown[]) => unknown;

export interface IpcHandlerMap {
    invoke: Record<string, IpcBindingListener>;
    send: Record<string, IpcBindingListener>;
}

export interface ContractBindingContext {
    event: unknown;
    broadcast<Namespace extends NamespaceKey, Method extends SubscribeMethodKey<Namespace>>(
        namespace: Namespace,
        method: Method,
        payload: Parameters<SubscribeListener<Namespace, Method>>[0],
    ): void;
    emitToSender<Namespace extends NamespaceKey, Method extends SubscribeMethodKey<Namespace>>(
        namespace: Namespace,
        method: Method,
        payload: Parameters<SubscribeListener<Namespace, Method>>[0],
    ): void;
}

export interface ContractBinder {
    bindSubscription<Namespace extends NamespaceKey, Method extends SubscribeMethodKey<Namespace>>(
        namespace: Namespace,
        method: Method,
        subscribe: (listener: SubscribeListener<Namespace, Method>) => void | (() => void),
    ): void;
    broadcast<Namespace extends NamespaceKey, Method extends SubscribeMethodKey<Namespace>>(
        namespace: Namespace,
        method: Method,
        payload: Parameters<SubscribeListener<Namespace, Method>>[0],
    ): void;
    emitToSender<Namespace extends NamespaceKey, Method extends SubscribeMethodKey<Namespace>>(
        event: unknown,
        namespace: Namespace,
        method: Method,
        payload: Parameters<SubscribeListener<Namespace, Method>>[0],
    ): void;
    handleInvoke<Namespace extends NamespaceKey, Method extends InvokeMethodKey<Namespace>>(
        namespace: Namespace,
        method: Method,
        handler: (
            context: ContractBindingContext,
            ...args: MethodArgs<Namespace, Method>
        ) => Awaitable<Awaited<MethodReturn<Namespace, Method>>>,
    ): void;
    handleSend<Namespace extends NamespaceKey, Method extends SendMethodKey<Namespace>>(
        namespace: Namespace,
        method: Method,
        handler: (context: ContractBindingContext, ...args: MethodArgs<Namespace, Method>) => void,
    ): void;
    registerInvokeNamespace<Namespace extends NamespaceKey>(
        namespace: Namespace,
        handlers: InvokeNamespaceHandlers<Namespace>,
    ): void;
    registerSendNamespace<Namespace extends NamespaceKey>(
        namespace: Namespace,
        handlers: SendNamespaceHandlers<Namespace>,
    ): void;
}

export interface CreateContractBinderOptions {
    broadcastEvent?: (channel: string, payload: unknown) => void;
}

const resolveEntry = <Namespace extends NamespaceKey, Method extends MethodKey<Namespace>>(
    namespace: Namespace,
    method: Method,
) => {
    const namespaceEntries = ipcContract[namespace] as Record<string, IpcContractEntry>;
    return namespaceEntries[method] as IpcContractEntry;
};

const resolveSender = (event: unknown): EventSender | undefined => {
    if (event == null || typeof event !== 'object' || !('sender' in event)) {
        return undefined;
    }

    return (event as { sender?: EventSender }).sender;
};

export const createContractBinder = ({
    broadcastEvent,
}: CreateContractBinderOptions = {}) => {
    const invokeHandlers: IpcHandlerMap['invoke'] = {};
    const sendHandlers: IpcHandlerMap['send'] = {};
    const subscriptionCleanups: Array<() => void> = [];

    const broadcast: ContractBinder['broadcast'] = (namespace, method, payload) => {
        const entry = resolveEntry(namespace, method);
        if (entry.transport !== 'subscribe') {
            throw new Error(`Cannot broadcast non-subscribe contract entry: ${String(namespace)}.${String(method)}.`);
        }

        broadcastEvent?.(entry.channel, payload);
    };

    const emitToSender: ContractBinder['emitToSender'] = (event, namespace, method, payload) => {
        const entry = resolveEntry(namespace, method);
        if (entry.transport !== 'subscribe') {
            throw new Error(`Cannot emit non-subscribe contract entry to sender: ${String(namespace)}.${String(method)}.`);
        }

        resolveSender(event)?.send?.(entry.channel, payload);
    };

    const createContext = (event: unknown): ContractBindingContext => ({
        event,
        broadcast: (namespace, method, payload) => {
            broadcast(namespace, method, payload);
        },
        emitToSender: (namespace, method, payload) => {
            emitToSender(event, namespace, method, payload);
        },
    });

    const binder: ContractBinder = {
        bindSubscription(namespace, method, subscribe) {
            const entry = resolveEntry(namespace, method);

            if (entry.transport !== 'subscribe') {
                throw new Error(`Cannot bind non-subscribe contract entry: ${String(namespace)}.${String(method)}.`);
            }

            const unsubscribe = subscribe(((payload: unknown) => {
                broadcast(namespace, method, payload as Parameters<SubscribeListener<typeof namespace, typeof method>>[0]);
            }) as SubscribeListener<typeof namespace, typeof method>);

            if (typeof unsubscribe === 'function') {
                subscriptionCleanups.push(unsubscribe);
            }
        },
        broadcast,
        emitToSender,
        handleInvoke(namespace, method, handler) {
            const entry = resolveEntry(namespace, method);

            if (entry.transport !== 'invoke') {
                throw new Error(`Cannot bind non-invoke contract entry: ${String(namespace)}.${String(method)}.`);
            }

            invokeHandlers[entry.channel] = (event, ...args) => handler(
                createContext(event),
                ...(args as MethodArgs<typeof namespace, typeof method>),
            );
        },
        handleSend(namespace, method, handler) {
            const entry = resolveEntry(namespace, method);

            if (entry.transport !== 'send') {
                throw new Error(`Cannot bind non-send contract entry: ${String(namespace)}.${String(method)}.`);
            }

            sendHandlers[entry.channel] = (event, ...args) => handler(
                createContext(event),
                ...(args as MethodArgs<typeof namespace, typeof method>),
            );
        },
        registerInvokeNamespace(namespace, handlers) {
            for (const [method, entry] of Object.entries(ipcContract[namespace])) {
                if (entry.transport !== 'invoke') {
                    continue;
                }

                const handler = handlers[method as keyof typeof handlers];
                if (typeof handler !== 'function') {
                    continue;
                }

                this.handleInvoke(
                    namespace,
                    method as InvokeMethodKey<typeof namespace>,
                    (_context, ...args) => handler(...args as never),
                );
            }
        },
        registerSendNamespace(namespace, handlers) {
            for (const [method, entry] of Object.entries(ipcContract[namespace])) {
                if (entry.transport !== 'send') {
                    continue;
                }

                const handler = handlers[method as keyof typeof handlers];
                if (typeof handler !== 'function') {
                    continue;
                }

                this.handleSend(
                    namespace,
                    method as SendMethodKey<typeof namespace>,
                    (_context, ...args) => handler(...args as never),
                );
            }
        },
    };

    const getHandlerMap = (): IpcHandlerMap => {
        for (const entry of listIpcContractEntries()) {
            if (entry.transport === 'invoke' && !invokeHandlers[entry.channel]) {
                throw new Error(`Missing IPC binding for ${entry.namespace}.${entry.method}.`);
            }

            if (entry.transport === 'send' && !sendHandlers[entry.channel]) {
                throw new Error(`Missing IPC binding for ${entry.namespace}.${entry.method}.`);
            }
        }

        return {
            invoke: { ...invokeHandlers },
            send: { ...sendHandlers },
        };
    };

    return {
        binder,
        disposeSubscriptions: () => {
            while (subscriptionCleanups.length > 0) {
                subscriptionCleanups.pop()?.();
            }
        },
        getHandlerMap,
    };
};