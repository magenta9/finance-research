import type { Readable, Writable } from 'node:stream';
import crypto from 'node:crypto';

import type { LoggerLike } from '../logger';
import type { PiStreamEvent } from './types';
import {
  attachPiJsonlReader,
  createPiWrapperErrorResponse,
  createPiWrapperSuccessResponse,
  isPiWrapperNotification,
  isPiWrapperRequest,
  isPiWrapperResponse,
  parsePiWrapperMessage,
  writePiWrapperMessage,
  type PiWrapperMethod,
  type PiWrapperRequestParams,
  type PiWrapperResponseResults,
} from './wrapper/protocol';

interface PiClientOptions {
  input: Readable;
  logger?: LoggerLike;
  onNotification?: (event: PiStreamEvent) => void;
  output: Writable;
  requestHandler?: <M extends PiWrapperMethod>(
    method: M,
    params: PiWrapperRequestParams[M],
  ) => Promise<PiWrapperResponseResults[M]>;
}

export class PiClient {
  private readonly input: Readable;

  private readonly logger?: LoggerLike;

  private readonly output: Writable;

  private readonly pending = new Map<string, {
    reject: (error: Error) => void;
    resolve: (value: unknown) => void;
  }>();

  private readonly requestHandler?: PiClientOptions['requestHandler'];

  private readonly subscribers = new Set<(event: PiStreamEvent) => void>();

  private detachReader: (() => void) | null = null;

  constructor(options: PiClientOptions) {
    this.input = options.input;
    this.logger = options.logger;
    this.output = options.output;
    this.requestHandler = options.requestHandler;

    if (options.onNotification) {
      this.subscribers.add(options.onNotification);
    }

    this.detachReader = attachPiJsonlReader(this.input, (line) => {
      void this.handleLine(line);
    });
  }

  onNotification(listener: (event: PiStreamEvent) => void) {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }

  async request<M extends PiWrapperMethod>(
    method: M,
    params: PiWrapperRequestParams[M],
  ): Promise<PiWrapperResponseResults[M]> {
    const id = crypto.randomUUID();

    return await new Promise<PiWrapperResponseResults[M]>((resolve, reject) => {
      this.pending.set(id, {
        reject,
        resolve: (value) => {
          resolve(value as PiWrapperResponseResults[M]);
        },
      });
      writePiWrapperMessage(this.output, {
        id,
        kind: 'request',
        method,
        params,
      });
    });
  }

  dispose(error?: Error) {
    this.detachReader?.();
    this.detachReader = null;

    for (const pending of this.pending.values()) {
      pending.reject(error ?? new Error('Agent runtime connection closed.'));
    }

    this.pending.clear();
  }

  private async handleLine(line: string) {
    if (!line.trim()) {
      return;
    }

    try {
      const message = parsePiWrapperMessage(line);

      if (isPiWrapperNotification(message)) {
        for (const subscriber of this.subscribers) {
          subscriber(message.params);
        }
        return;
      }

      if (isPiWrapperResponse(message)) {
        const pending = this.pending.get(message.id);

        if (!pending) {
          return;
        }

        this.pending.delete(message.id);

        if (message.ok) {
          pending.resolve(message.result);
          return;
        }

        pending.reject(new Error(message.error.message));
        return;
      }

      if (!isPiWrapperRequest(message)) {
        return;
      }

      if (!this.requestHandler) {
        writePiWrapperMessage(this.output, createPiWrapperErrorResponse(message.id, {
          code: 'UNSUPPORTED_REQUEST',
          message: `Unsupported Agent runtime request: ${message.method}`,
        }));
        return;
      }

      try {
        const result = await this.requestHandler(message.method, message.params as never);
        writePiWrapperMessage(this.output, createPiWrapperSuccessResponse(message.id, result as never));
      } catch (error) {
        writePiWrapperMessage(this.output, createPiWrapperErrorResponse(message.id, {
          code: 'REQUEST_FAILED',
          message: error instanceof Error ? error.message : String(error),
        }));
      }
    } catch (error) {
      this.logger?.warn('main', 'Failed to parse Agent runtime message.', {
        error: error instanceof Error ? error.message : String(error),
        line: line.slice(0, 300),
      });
    }
  }
}
