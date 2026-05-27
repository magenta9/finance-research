import { ipcContract, type IpcContractEntry } from './ipc-contract';
import type { QuantdeskApi } from './types/api';

type NamespaceKey = keyof QuantdeskApi;
type MethodKey<Namespace extends NamespaceKey> = keyof QuantdeskApi[Namespace] & string;

type MethodArgs<
    Namespace extends NamespaceKey,
    Method extends MethodKey<Namespace>,
> = QuantdeskApi[Namespace][Method] extends (...args: infer Args) => unknown ? Args : never;

type MethodResult<
    Namespace extends NamespaceKey,
    Method extends MethodKey<Namespace>,
> = QuantdeskApi[Namespace][Method] extends (...args: unknown[]) => infer Result ? Result : never;

export interface QuantdeskPort {
    invoke<Namespace extends NamespaceKey, Method extends MethodKey<Namespace>>(
        namespace: Namespace,
        method: Method,
        entry: IpcContractEntry,
        args: MethodArgs<Namespace, Method>,
    ): MethodResult<Namespace, Method>;
    send<Namespace extends NamespaceKey, Method extends MethodKey<Namespace>>(
        namespace: Namespace,
        method: Method,
        entry: IpcContractEntry,
        args: MethodArgs<Namespace, Method>,
    ): void;
    subscribe<Namespace extends NamespaceKey, Method extends MethodKey<Namespace>>(
        namespace: Namespace,
        method: Method,
        entry: IpcContractEntry,
        listener: MethodArgs<Namespace, Method>[0],
    ): MethodResult<Namespace, Method>;
}

const buildMethod = <Namespace extends NamespaceKey, Method extends MethodKey<Namespace>>(
    namespace: Namespace,
    method: Method,
    entry: IpcContractEntry,
    port: QuantdeskPort,
): QuantdeskApi[Namespace][Method] => {
    if (entry.transport === 'invoke') {
        return ((...args: MethodArgs<Namespace, Method>) =>
            port.invoke(namespace, method, entry, args)) as QuantdeskApi[Namespace][Method];
    }

    if (entry.transport === 'send') {
        return ((...args: MethodArgs<Namespace, Method>) => {
            port.send(namespace, method, entry, args);
        }) as QuantdeskApi[Namespace][Method];
    }

    return ((listener: MethodArgs<Namespace, Method>[0]) =>
        port.subscribe(namespace, method, entry, listener)) as QuantdeskApi[Namespace][Method];
};

const buildNamespace = <Namespace extends NamespaceKey>(
    namespace: Namespace,
    entries: Record<string, IpcContractEntry>,
    port: QuantdeskPort,
): QuantdeskApi[Namespace] => {
    return Object.fromEntries(
        Object.entries(entries).map(([method, entry]) => [
            method,
            buildMethod(namespace, method as MethodKey<Namespace>, entry, port),
        ]),
    ) as unknown as QuantdeskApi[Namespace];
};

export const createQuantdeskApiFromPort = (port: QuantdeskPort): QuantdeskApi => {
    return Object.fromEntries(
        Object.entries(ipcContract).map(([namespace, entries]) => [
            namespace,
            buildNamespace(namespace as NamespaceKey, entries as Record<string, IpcContractEntry>, port),
        ]),
    ) as unknown as QuantdeskApi;
};