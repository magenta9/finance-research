import type {
  LogWriteInput,
} from '@quantdesk/shared';
import type { QuantdeskApi } from '@quantdesk/shared/types/api';
import { ipcContract, type IpcContractEntry } from '@quantdesk/shared/ipc-contract';
import {
  createQuantdeskApiFromPort,
  type QuantdeskPort,
} from '@quantdesk/shared/quantdesk-port';

export type InvokeHandler = (
  channel: string,
  ...args: unknown[]
) => Promise<unknown>;

export type SendHandler = (
  channel: string,
  ...args: unknown[]
) => void;

export type SubscribeHandler = <Payload>(
  channel: string,
  listener: (payload: Payload) => void,
) => (() => void);

const defaultInvokeTimeoutMs = 20_000;

const sensitiveLogChannels = new Set<string>([
  ipcContract.piAgent.sendMessage.channel,
  ipcContract.research.startResearch.channel,
]);

const redactArgsForLog = (channel: string, args: unknown[]) => (
  sensitiveLogChannels.has(channel) ? ['[redacted]'] : args
);

const invokeWithTimeout = (
  invoke: InvokeHandler,
  send: SendHandler,
  entry: IpcContractEntry,
  args: unknown[],
) => {
  const timeoutMs = entry.timeoutMs ?? defaultInvokeTimeoutMs;
  const channel = entry.channel;
  const logArgs = redactArgsForLog(channel, args);

  const emitPreloadLog = (entry: LogWriteInput) => {
    if (channel === ipcContract.log.write.channel || channel === ipcContract.log.writeBatch.channel) {
      return;
    }

    try {
      send(ipcContract.log.write.channel, entry);
    } catch (error) {
      console.warn('[preload] Failed to emit preload log entry.', {
        channel,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      emitPreloadLog({
        context: { args: logArgs, timeoutMs },
        level: 'warn',
        message: `IPC timeout: ${channel} (${timeoutMs}ms)`,
        source: 'preload',
      });
      reject(new Error(`IPC 调用超时：${channel}（${timeoutMs}ms）`));
    }, timeoutMs);

    void invoke(entry.channel, ...args)
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        emitPreloadLog({
          context: { args: logArgs },
          error: error instanceof Error ? error.message : String(error),
          level: 'error',
          message: `IPC error: ${channel}`,
          source: 'preload',
          stack: error instanceof Error ? error.stack : undefined,
        });
        reject(error);
      });
  });
};

const createPreloadPort = (
  invoke: InvokeHandler,
  send: SendHandler,
  subscribe?: SubscribeHandler,
): QuantdeskPort => ({
  invoke: (_namespace, _method, entry, args) =>
    invokeWithTimeout(invoke, send, entry as IpcContractEntry, args) as never,
  send: (_namespace, _method, entry, args) => {
    send((entry as IpcContractEntry).channel, ...args);
  },
  subscribe: (_namespace, _method, entry, listener) => (
    subscribe
      ? subscribe((entry as IpcContractEntry).channel, listener as (payload: unknown) => void)
      : () => undefined
  ) as never,
});

export const createQuantdeskApi = (
  invoke: InvokeHandler,
  send: SendHandler,
  subscribe?: SubscribeHandler,
): QuantdeskApi => createQuantdeskApiFromPort(createPreloadPort(invoke, send, subscribe));
