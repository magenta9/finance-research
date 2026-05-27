import { dialog } from 'electron';

import type {
  PiAgentStreamEvent,
  PiCancelRunRequest,
  PiCancelRunResponse,
  PiDiscardAttachmentsRequest,
  PiSendMessageRequest,
  PiSendMessageResponse,
  PiStageAttachmentsResponse,
} from '@quantdesk/shared';

import { PI_RISK_GATE_BLOCK_MESSAGE } from '../preferences/preferences-service';
import { createPiAttachmentService } from './attachments';
import type { PiRiskGatePreferences } from './preferences';
import { createPiSessionAdapter } from './session-adapter';
import type { PiManager } from './manager';

export const createUnavailablePiAgentHandlers = (message: string) => ({
  cancelRun: async (): Promise<PiCancelRunResponse> => {
    throw new Error(message);
  },
  deleteSession: async () => {
    throw new Error(message);
  },
  discardAttachments: async () => {
    throw new Error(message);
  },
  getSession: async () => {
    throw new Error(message);
  },
  getSessionTranscript: async () => {
    throw new Error(message);
  },
  listSessions: async () => {
    throw new Error(message);
  },
  listSkills: async () => {
    throw new Error(message);
  },
  stageAttachments: async (): Promise<PiStageAttachmentsResponse> => {
    throw new Error(message);
  },
  sendMessage: async (): Promise<PiSendMessageResponse> => {
    throw new Error(message);
  },
  subscribe: (_listener: (payload: PiAgentStreamEvent) => void) => () => undefined,
});

export const createPiAgentHandlers = (
  piManager: PiManager,
  riskGatePreferences: PiRiskGatePreferences,
) => {
  const attachmentService = createPiAttachmentService({
    getDirectories: async () => (await piManager.getStatus()).directories,
  });
  const sessionAdapter = createPiSessionAdapter({
    getRiskGateState: () => riskGatePreferences.getRiskGateState(),
    getSessionRunStatus: (sessionId) => piManager.getSessionRunStatus(sessionId),
    getSessionTranscript: async (sessionId) => await piManager.getSessionTranscript(sessionId),
    getStatus: async () => await piManager.getStatus(),
    listSessions: async () => await piManager.listSessions(),
    listToolInvocations: async (sessionId) => await piManager.listToolInvocations(sessionId),
  });

  return {
    cancelRun: async (request: PiCancelRunRequest): Promise<PiCancelRunResponse> => {
      return await piManager.cancelRun(request.runId, request.sessionId);
    },
    deleteSession: async (sessionId: string): Promise<boolean> => {
      return await piManager.deleteSession(sessionId);
    },
    discardAttachments: async (request: PiDiscardAttachmentsRequest): Promise<void> => {
      await attachmentService.discard(request.attachmentIds);
    },
    getSession: (sessionId: string) => sessionAdapter.getSession(sessionId),
    getSessionTranscript: (sessionId: string) => sessionAdapter.getSessionTranscript(sessionId),
    listSessions: () => sessionAdapter.listSessions(),
    listSkills: () => piManager.listSkills(),
    stageAttachments: async (): Promise<PiStageAttachmentsResponse> => {
      const result = await dialog.showOpenDialog({
        filters: [{
          extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'md', 'txt', 'csv', 'json', 'yaml', 'yml', 'log'],
          name: 'Pi attachments',
        }],
        properties: ['openFile', 'multiSelections'],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { attachments: [], rejected: [] };
      }

      return await attachmentService.stageFilePaths(result.filePaths);
    },
    sendMessage: async (request: PiSendMessageRequest): Promise<PiSendMessageResponse> => {
      if (!riskGatePreferences.getRiskGateState().acknowledged) {
        throw new Error(PI_RISK_GATE_BLOCK_MESSAGE);
      }

      const attachments = await attachmentService.resolve(request.attachments);
      const response = await piManager.sendMessage({
        attachments,
        message: request.message,
        sessionId: request.sessionId,
      });

      void attachmentService.discard(attachments.map((attachment) => attachment.id)).catch((error: unknown) => {
        console.warn('[pi-agent] Failed to discard attachments after send.', error);
      });

      return response;
    },
    subscribe: (listener: (payload: PiAgentStreamEvent) => void) =>
      piManager.subscribe((event) => {
        void sessionAdapter.mapStreamEvent(event).then(listener);
      }),
  };
};
