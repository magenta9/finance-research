import process from 'node:process';

import { PiWrapperRuntime } from './runtime';
import {
  createPiWrapperErrorResponse,
  createPiWrapperSuccessResponse,
  isPiWrapperRequest,
  isPiWrapperResponse,
  parsePiWrapperMessage,
  writePiWrapperMessage,
  attachPiJsonlReader,
} from './protocol';
import type {
  PiCancelRunInput,
  PiGenerateTitleInput,
  PiRuntimeDirectories,
  PiSendMessageInput,
  PiToolHostExecuteResponse,
} from '../types';

export class PiWrapperServer {
  private readonly pending = new Map<string, {
    reject: (error: Error) => void;
    resolve: (value: PiToolHostExecuteResponse) => void;
  }>();

  private readonly runtime: PiWrapperRuntime;

  constructor(directories: PiRuntimeDirectories) {
    this.runtime = new PiWrapperRuntime({
      directories,
      emitEvent: (event) => {
        writePiWrapperMessage(process.stdout, {
          event: event.type,
          kind: 'notification',
          params: event,
        });
      },
      requestHost: async (request) => {
        const id = `tool-host-${request.toolCallId}`;

        return await new Promise((resolve, reject) => {
          this.pending.set(id, { reject, resolve });
          writePiWrapperMessage(process.stdout, {
            id,
            kind: 'request',
            method: 'toolHost.execute',
            params: request,
          });
        });
      },
    });
  }

  async run() {
    attachPiJsonlReader(process.stdin, (line) => {
      void this.handleLine(line);
    });

    process.stdin.resume();
    return await new Promise<never>(() => { });
  }

  async dispose() {
    this.rejectPending(new Error('Agent runtime shutting down.'));
    await this.runtime.dispose();
  }

  private async handleLine(line: string) {
    if (!line.trim()) {
      return;
    }

    const message = parsePiWrapperMessage(line);

    if (isPiWrapperResponse(message)) {
      const pending = this.pending.get(message.id);

      if (!pending) {
        return;
      }

      this.pending.delete(message.id);

      if (message.ok) {
        pending.resolve(message.result as PiToolHostExecuteResponse);
        return;
      }

      pending.reject(new Error(message.error.message));
      return;
    }

    if (!isPiWrapperRequest(message)) {
      return;
    }

    try {
      switch (message.method) {
        case 'health': {
          writePiWrapperMessage(process.stdout, createPiWrapperSuccessResponse(message.id, await this.runtime.health()));
          return;
        }
        case 'getDiagnostics': {
          writePiWrapperMessage(process.stdout, createPiWrapperSuccessResponse(message.id, await this.runtime.getDiagnostics()));
          return;
        }
        case 'listSessions': {
          writePiWrapperMessage(process.stdout, createPiWrapperSuccessResponse(message.id, await this.runtime.listSessions()));
          return;
        }
        case 'listSkills': {
          writePiWrapperMessage(process.stdout, createPiWrapperSuccessResponse(message.id, await this.runtime.listSkills()));
          return;
        }
        case 'getSessionTranscript': {
          const params = message.params as { sessionId: string };
          writePiWrapperMessage(
            process.stdout,
            createPiWrapperSuccessResponse(
              message.id,
              await this.runtime.getSessionTranscript(params.sessionId),
            ),
          );
          return;
        }
        case 'generateTitle': {
          const params = message.params as PiGenerateTitleInput;
          writePiWrapperMessage(process.stdout, createPiWrapperSuccessResponse(message.id, await this.runtime.generateTitle(params)));
          return;
        }
        case 'sendMessage': {
          const params = message.params as PiSendMessageInput;
          writePiWrapperMessage(process.stdout, createPiWrapperSuccessResponse(message.id, await this.runtime.sendMessage(params)));
          return;
        }
        case 'cancelRun': {
          const params = message.params as PiCancelRunInput;
          writePiWrapperMessage(process.stdout, createPiWrapperSuccessResponse(message.id, await this.runtime.cancelRun(params)));
          return;
        }
        case 'listToolInvocations': {
          const params = message.params as { sessionId: string };
          writePiWrapperMessage(
            process.stdout,
            createPiWrapperSuccessResponse(
              message.id,
              await this.runtime.listToolInvocations(params.sessionId),
            ),
          );
          return;
        }
        default: {
          writePiWrapperMessage(process.stdout, createPiWrapperErrorResponse(message.id, {
            code: 'UNKNOWN_METHOD',
            message: `Unknown Agent runtime method: ${message.method}`,
          }));
        }
      }
    } catch (error) {
      writePiWrapperMessage(process.stdout, createPiWrapperErrorResponse(message.id, {
        code: 'REQUEST_FAILED',
        message: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  private rejectPending(error: Error) {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }

    this.pending.clear();
  }
}
