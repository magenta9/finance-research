import type { Readable, Writable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

import { isRecord } from '@quantdesk/shared/type-guards';

import type {
  PiCancelRunInput,
  PiCancelRunResult,
  PiGenerateTitleInput,
  PiGenerateTitleResult,
  PiRuntimeStatus,
  PiSendMessageInput,
  PiSendMessageResult,
  PiWrapperSessionSummary,
  PiWrapperSessionTranscript,
  PiStreamEvent,
  PiToolHostExecuteRequest,
  PiToolHostExecuteResponse,
  PiToolInvocation,
  PiWrapperHealth,
  PiWrapperSkillSummary,
} from '../types';

export type PiWrapperMethod =
  | 'health'
  | 'getDiagnostics'
  | 'listSessions'
  | 'listSkills'
  | 'getSessionTranscript'
  | 'generateTitle'
  | 'sendMessage'
  | 'cancelRun'
  | 'listToolInvocations'
  | 'toolHost.execute';

export interface PiWrapperRequestParams {
  'cancelRun': PiCancelRunInput;
  'getDiagnostics': undefined;
  'generateTitle': PiGenerateTitleInput;
  'getSessionTranscript': { sessionId: string };
  'health': undefined;
  'listSessions': undefined;
  'listSkills': undefined;
  'listToolInvocations': { sessionId: string };
  'sendMessage': PiSendMessageInput;
  'toolHost.execute': PiToolHostExecuteRequest;
}

export interface PiWrapperResponseResults {
  'cancelRun': PiCancelRunResult;
  'getDiagnostics': PiRuntimeStatus;
  'generateTitle': PiGenerateTitleResult;
  'getSessionTranscript': PiWrapperSessionTranscript;
  'health': PiWrapperHealth;
  'listSessions': PiWrapperSessionSummary[];
  'listSkills': PiWrapperSkillSummary[];
  'listToolInvocations': PiToolInvocation[];
  'sendMessage': PiSendMessageResult;
  'toolHost.execute': PiToolHostExecuteResponse;
}

export interface PiWrapperError {
  code: string;
  message: string;
}

export interface PiWrapperRequest<M extends PiWrapperMethod = PiWrapperMethod> {
  id: string;
  kind: 'request';
  method: M;
  params?: PiWrapperRequestParams[M];
}

export interface PiWrapperSuccessResponse<M extends PiWrapperMethod = PiWrapperMethod> {
  id: string;
  kind: 'response';
  ok: true;
  result: PiWrapperResponseResults[M];
}

export interface PiWrapperErrorResponse {
  error: PiWrapperError;
  id: string;
  kind: 'response';
  ok: false;
}

export interface PiWrapperNotification {
  event: PiStreamEvent['type'];
  kind: 'notification';
  params: PiStreamEvent;
}

export type PiWrapperResponse = PiWrapperSuccessResponse | PiWrapperErrorResponse;

export type PiWrapperMessage = PiWrapperRequest | PiWrapperResponse | PiWrapperNotification;

export const isPiWrapperRequest = (message: PiWrapperMessage): message is PiWrapperRequest =>
  message.kind === 'request';

export const isPiWrapperResponse = (message: PiWrapperMessage): message is PiWrapperResponse =>
  message.kind === 'response';

export const isPiWrapperNotification = (message: PiWrapperMessage): message is PiWrapperNotification =>
  message.kind === 'notification';

export const createPiWrapperSuccessResponse = <M extends PiWrapperMethod>(
  id: string,
  result: PiWrapperResponseResults[M],
): PiWrapperSuccessResponse<M> => ({
  id,
  kind: 'response',
  ok: true,
  result,
});

export const createPiWrapperErrorResponse = (
  id: string,
  error: PiWrapperError,
): PiWrapperErrorResponse => ({
  error,
  id,
  kind: 'response',
  ok: false,
});

export const serializePiWrapperMessage = (message: PiWrapperMessage) => `${JSON.stringify(message)}\n`;

export const writePiWrapperMessage = (stream: Writable, message: PiWrapperMessage) => {
  stream.write(serializePiWrapperMessage(message));
};

export const attachPiJsonlReader = (stream: Readable, onLine: (line: string) => void) => {
  const decoder = new StringDecoder('utf8');
  let buffer = '';

  const flushBuffer = () => {
    let newlineIndex = buffer.indexOf('\n');

    while (newlineIndex !== -1) {
      let line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);

      if (line.endsWith('\r')) {
        line = line.slice(0, -1);
      }

      onLine(line);
      newlineIndex = buffer.indexOf('\n');
    }
  };

  const handleData = (chunk: Buffer | string) => {
    buffer += typeof chunk === 'string' ? chunk : decoder.write(chunk);
    flushBuffer();
  };

  const handleEnd = () => {
    buffer += decoder.end();

    if (buffer.length > 0) {
      onLine(buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer);
      buffer = '';
    }
  };

  stream.on('data', handleData);
  stream.on('end', handleEnd);

  return () => {
    stream.off('data', handleData);
    stream.off('end', handleEnd);
  };
};

export const parsePiWrapperMessage = (line: string): PiWrapperMessage => {
  const parsed = JSON.parse(line) as unknown;

  if (!isRecord(parsed) || typeof parsed.kind !== 'string') {
    throw new Error('Invalid pi wrapper message envelope.');
  }

  if (parsed.kind === 'request') {
    if (typeof parsed.id !== 'string' || typeof parsed.method !== 'string') {
      throw new Error('Invalid pi wrapper request envelope.');
    }

    return parsed as unknown as PiWrapperRequest;
  }

  if (parsed.kind === 'response') {
    if (typeof parsed.id !== 'string' || typeof parsed.ok !== 'boolean') {
      throw new Error('Invalid pi wrapper response envelope.');
    }

    return parsed as unknown as PiWrapperResponse;
  }

  if (parsed.kind === 'notification') {
    if (typeof parsed.event !== 'string') {
      throw new Error('Invalid pi wrapper notification envelope.');
    }

    return parsed as unknown as PiWrapperNotification;
  }

  throw new Error(`Unknown pi wrapper message kind: ${String(parsed.kind)}`);
};
